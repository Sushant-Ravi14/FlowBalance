const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * FlowBalance Hand-Rolled WebSocket Server
 * Implements RFC 6455 with zero npm dependencies.
 * Only uses Node.js standard libraries: crypto, events, http, net.
 */

// RFC 6455 Magic GUID constant for WebSocket Handshake
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// Frame Opcodes
const OPCODES = {
    CONTINUATION: 0x0,
    TEXT: 0x1,
    BINARY: 0x2,
    CLOSE: 0x8,
    PING: 0x9,
    PONG: 0xA
};

class WebSocketServer extends EventEmitter {
    constructor(options = {}) {
        super();
        this.clients = new Set();
        this.server = options.server || null;

        if (this.server) {
            this.attach(this.server);
        }
    }

    /**
     * Attach WebSocket upgrade handler to an existing Node.js http.Server
     * @param {import('http').Server} httpServer 
     */
    attach(httpServer) {
        this.server = httpServer;
        this.server.on('upgrade', (req, socket, head) => {
            this.handleUpgrade(req, socket, head);
        });
    }

    /**
     * Handle the HTTP 101 Switching Protocols Handshake (RFC 6455 §4.2)
     */
    handleUpgrade(req, socket, head) {
        const upgradeHeader = req.headers['upgrade'];
        if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
            socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
            socket.destroy();
            return;
        }

        const clientKey = req.headers['sec-websocket-key'];
        if (!clientKey) {
            socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
            socket.destroy();
            return;
        }

        // Compute Sec-WebSocket-Accept: Base64( SHA-1( key + GUID ) )
        const acceptKey = crypto
            .createHash('sha1')
            .update(clientKey.trim() + WS_GUID)
            .digest('base64');

        // Send 101 Response
        const headers = [
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${acceptKey}`,
            '\r\n'
        ];

        socket.write(headers.join('\r\n'));

        // Client connection setup
        socket.setNoDelay(true);
        this.clients.add(socket);

        // Frame buffer for incoming TCP chunks
        let buffer = Buffer.alloc(0);

        if (head && head.length > 0) {
            buffer = Buffer.concat([buffer, head]);
        }

        socket.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            buffer = this.processFrames(socket, buffer);
        });

        const cleanup = () => {
            if (this.clients.has(socket)) {
                this.clients.delete(socket);
                this.emit('clientDisconnected', socket);
            }
        };

        socket.on('close', cleanup);
        socket.on('end', cleanup);
        socket.on('error', () => {
            cleanup();
            socket.destroy();
        });

        this.emit('connection', socket, req);
    }

    /**
     * Process raw binary stream and extract RFC 6455 frames
     * Handles variable length payloads and masking
     * @param {import('net').Socket} socket 
     * @param {Buffer} buffer 
     * @returns {Buffer} remaining unprocessed buffer
     */
    processFrames(socket, buffer) {
        while (buffer.length >= 2) {
            const firstByte = buffer[0];
            const secondByte = buffer[1];

            const fin = (firstByte & 0x80) !== 0;
            const opcode = firstByte & 0x0F;
            const masked = (secondByte & 0x80) !== 0;
            let payloadLen = secondByte & 0x7F;

            let offset = 2;

            if (payloadLen === 126) {
                if (buffer.length < 4) return buffer; // Not enough data for extended length
                payloadLen = buffer.readUInt16BE(offset);
                offset += 2;
            } else if (payloadLen === 127) {
                if (buffer.length < 10) return buffer; // Not enough data for 64-bit length
                const high = buffer.readUInt32BE(offset);
                const low = buffer.readUInt32BE(offset + 4);
                payloadLen = high * 4294967296 + low;
                offset += 8;
            }

            let maskingKey = null;
            if (masked) {
                if (buffer.length < offset + 4) return buffer; // Not enough data for masking key
                maskingKey = buffer.slice(offset, offset + 4);
                offset += 4;
            }

            if (buffer.length < offset + payloadLen) {
                // Whole frame payload hasn't arrived yet
                return buffer;
            }

            const rawPayload = buffer.slice(offset, offset + payloadLen);
            let payload = Buffer.alloc(payloadLen);

            if (masked && maskingKey) {
                // Client-to-server frames must be unmasked using 4-byte XOR key (RFC 6455 §5.3)
                for (let i = 0; i < payloadLen; i++) {
                    payload[i] = rawPayload[i] ^ maskingKey[i % 4];
                }
            } else {
                payload = rawPayload;
            }

            // Consume processed frame from buffer
            buffer = buffer.slice(offset + payloadLen);

            this.handleFrame(socket, opcode, payload, fin);
        }

        return buffer;
    }

    /**
     * Handle unmasked frame per RFC 6455 opcode
     */
    handleFrame(socket, opcode, payload, fin) {
        switch (opcode) {
            case OPCODES.TEXT: {
                const messageStr = payload.toString('utf8');
                this.emit('message', messageStr, socket);
                break;
            }
            case OPCODES.BINARY: {
                this.emit('binary', payload, socket);
                break;
            }
            case OPCODES.PING: {
                // RFC 6455 §5.5.2: Pong frame MUST have same payload as Ping
                const pongFrame = this.encodeFrame(payload, OPCODES.PONG);
                socket.write(pongFrame);
                break;
            }
            case OPCODES.PONG: {
                this.emit('pong', socket);
                break;
            }
            case OPCODES.CLOSE: {
                // RFC 6455 §5.5.1: Echo close frame and terminate socket
                const closeFrame = this.encodeFrame(payload, OPCODES.CLOSE);
                socket.write(closeFrame, () => {
                    socket.end();
                });
                if (this.clients.has(socket)) {
                    this.clients.delete(socket);
                }
                break;
            }
            default:
                break;
        }
    }

    /**
     * Encode payload into unmasked server-to-client WebSocket frame (RFC 6455 §5.2)
     * Server frames sent to client are NEVER masked.
     * @param {string|Buffer|object} data 
     * @param {number} opcode 
     * @returns {Buffer}
     */
    encodeFrame(data, opcode = OPCODES.TEXT) {
        let payloadBuf;
        if (Buffer.isBuffer(data)) {
            payloadBuf = data;
        } else if (typeof data === 'object') {
            payloadBuf = Buffer.from(JSON.stringify(data), 'utf8');
        } else {
            payloadBuf = Buffer.from(String(data), 'utf8');
        }

        const length = payloadBuf.length;
        let header;

        if (length < 126) {
            header = Buffer.alloc(2);
            header[0] = 0x80 | opcode; // FIN bit set + Opcode
            header[1] = length;         // Mask bit = 0, Length = length
        } else if (length <= 65535) {
            header = Buffer.alloc(4);
            header[0] = 0x80 | opcode;
            header[1] = 126;            // Extended 16-bit payload length indicator
            header.writeUInt16BE(length, 2);
        } else {
            header = Buffer.alloc(10);
            header[0] = 0x80 | opcode;
            header[1] = 127;            // Extended 64-bit payload length indicator
            const high = Math.floor(length / 4294967296);
            const low = length % 4294967296;
            header.writeUInt32BE(high, 2);
            header.writeUInt32BE(low, 6);
        }

        return Buffer.concat([header, payloadBuf]);
    }

    /**
     * Broadcast an event or object to all connected WebSocket clients
     * @param {object|string} data 
     */
    broadcast(data) {
        if (this.clients.size === 0) return;

        const frame = this.encodeFrame(data, OPCODES.TEXT);
        for (const socket of this.clients) {
            if (socket.writable) {
                socket.write(frame);
            }
        }
    }

    /**
     * Wire this WebSocket server to an EventEmitter-based ProxyServer
     * Sends initial state on connection, and streams real-time events.
     * @param {import('events').EventEmitter} proxyServer 
     */
    wireToProxy(proxyServer) {
        // Send initial topology state whenever a new client connects
        this.on('connection', (socket) => {
            const initPayload = {
                type: 'init',
                timestamp: Date.now(),
                algorithm: proxyServer.algorithm || 'round-robin',
                backends: proxyServer.backends ? proxyServer.backends.map(b => ({
                    id: b.id,
                    host: b.host,
                    port: b.port,
                    isHealthy: b.isHealthy,
                    circuitState: proxyServer.circuitBreaker ? proxyServer.circuitBreaker.getState(b.id) : 'CLOSED',
                    activeConnections: b.activeConnections,
                    latency: b.latency
                })) : []
            };
            const frame = this.encodeFrame(initPayload, OPCODES.TEXT);
            if (socket.writable) {
                socket.write(frame);
            }
        });

        // Forward proxy events
        proxyServer.on('requestRouted', (evt) => {
            this.broadcast({
                type: 'routed',
                timestamp: Date.now(),
                ...evt
            });
        });

        proxyServer.on('requestCompleted', (evt) => {
            this.broadcast({
                type: 'request',
                timestamp: Date.now(),
                backend: evt.backendId,
                method: evt.method,
                path: evt.path,
                status: evt.statusCode,
                latency: evt.duration,
                backends: proxyServer.backends ? proxyServer.backends.map(b => ({
                    id: b.id,
                    isHealthy: b.isHealthy,
                    circuitState: proxyServer.circuitBreaker ? proxyServer.circuitBreaker.getState(b.id) : 'CLOSED',
                    activeConnections: b.activeConnections,
                    latency: b.latency
                })) : []
            });
        });

        proxyServer.on('healthChange', (evt) => {
            this.broadcast({
                type: 'health',
                timestamp: Date.now(),
                backend: evt.backendId,
                healthy: evt.status === 'healthy',
                circuitState: proxyServer.circuitBreaker ? proxyServer.circuitBreaker.getState(evt.backendId) : 'CLOSED',
                latency: evt.latency,
                backends: proxyServer.backends ? proxyServer.backends.map(b => ({
                    id: b.id,
                    isHealthy: b.isHealthy,
                    circuitState: proxyServer.circuitBreaker ? proxyServer.circuitBreaker.getState(b.id) : 'CLOSED',
                    activeConnections: b.activeConnections,
                    latency: b.latency
                })) : []
            });
        });

        proxyServer.on('circuit_state', (evt) => {
            this.broadcast({
                type: 'circuit_state',
                timestamp: Date.now(),
                ...evt
            });
        });

        proxyServer.on('rate_limited', (evt) => {
            this.broadcast({
                type: 'rate_limited',
                timestamp: Date.now(),
                ...evt
            });
        });

        proxyServer.on('trace', (trace) => {
            this.broadcast({
                type: 'trace',
                ...trace
            });
        });
    }
}



module.exports = WebSocketServer;
