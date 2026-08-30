const http = require('http');

class ProxyServer {
    constructor(backends, algorithm = 'round-robin') {
        this.backends = backends.map(b => ({
            id: `${b.host}:${b.port}`,
            host: b.host,
            port: b.port,
            isHealthy: true,
            activeConnections: 0,
            latency: 0,
            failures: 0
        }));
        this.algorithm = algorithm;
        this.rrIndex = 0;
    }
    start(port = 8080) {
        this.server = http.createServer((req, res) => this.handleIncomingRequest(req, res));
        this.server.listen(port, () => {
            console.log(`[SYSTEM] FlowBalance Proxy listening on port ${port} | Algorithm: ${this.algorithm}`);
        });
    }

    handleIncomingRequest(req, res) {
        res.writeHead(200);
        res.end('Proxy Running');
    }
}

module.exports = ProxyServer;
