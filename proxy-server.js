const http = require('http');
const https = require('https');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const EventEmitter = require('events');
const WebSocketServer = require('./websocket-server');
const TokenBucketRateLimiter = require('./rate-limiter');
const CircuitBreakerManager = require('./circuit-breaker');
const RequestTracer = require('./tracer');

/**
 * FlowBalance Proxy Server
 * A zero-dependency reverse proxy, load balancer, rate limiter,
 * circuit breaker, request ID tracer, and real-time streaming hub.
 */

class ProxyServer extends EventEmitter {
    /**
     * @param {Array<{host: string, port: number}>} backends 
     * @param {object} [options]
     * @param {string} [options.algorithm='round-robin'] - 'round-robin' or 'least-connections'
     * @param {object} [options.rateLimiter] - Token bucket rate limiter config { rps, burst }
     * @param {object} [options.circuitBreaker] - Circuit breaker config { failureThreshold, cooldownMs }
     * @param {object} [options.tracer] - Request tracing config { maxTraces }
     * @param {boolean} [options.useTls=false] - Whether to serve via HTTPS/TLS
     * @param {string} [options.sslKeyPath] - Path to SSL private key file
     * @param {string} [options.sslCertPath] - Path to SSL certificate file
     */
    constructor(backends, options = {}) {
        super();
        this.backends = backends.map(b => ({
            id: `${b.host}:${b.port}`,
            host: b.host,
            port: b.port,
            isHealthy: true,
            activeConnections: 0,
            latency: 0,
            failures: 0
        }));

        this.algorithm = typeof options === 'string' ? options : (options.algorithm || 'round-robin');
        this.rrIndex = 0;
        this.healthCheckInterval = null;
        this.wss = null;

        // Process management for on-demand UI controls
        this.managedProcesses = new Map(); // port -> ChildProcess
        this.trafficProcess = null; // ChildProcess for traffic-generator

        // TLS Configuration
        this.useTls = options.useTls || process.env.USE_TLS === 'true';
        this.sslKeyPath = options.sslKeyPath || process.env.SSL_KEY_PATH || path.join(__dirname, 'key.pem');
        this.sslCertPath = options.sslCertPath || process.env.SSL_CERT_PATH || path.join(__dirname, 'cert.pem');

        // Rate Limiter Subsystem (Token Bucket)
        this.rateLimiter = new TokenBucketRateLimiter(options.rateLimiter || {
            rps: parseInt(process.env.RATE_LIMIT_RPS, 10) || 20,
            burst: parseInt(process.env.RATE_LIMIT_BURST, 10) || 40
        });
        this.rateLimiter.on('rate_limited', (evt) => {
            this.emit('rate_limited', evt);
        });

        // Circuit Breaker Subsystem (CLOSED / OPEN / HALF_OPEN)
        this.circuitBreaker = new CircuitBreakerManager(options.circuitBreaker || {
            failureThreshold: parseInt(process.env.CB_FAILURE_THRESHOLD, 10) || 5,
            cooldownMs: parseInt(process.env.CB_COOLDOWN_MS, 10) || 10000
        });
        this.circuitBreaker.on('circuit_state', (evt) => {
            this.emit('circuit_state', evt);
        });

        // Request Tracing Subsystem (Lifecycle Timeline per Request ID)
        this.tracer = new RequestTracer(options.tracer || {
            maxTraces: parseInt(process.env.MAX_TRACES, 10) || 200
        });
        this.tracer.on('trace', (trace) => {
            this.emit('trace', trace);
        });
    }

    start(port = 8080, host = '0.0.0.0') {
        const requestHandler = (req, res) => this.handleIncomingRequest(req, res);

        if (this.useTls) {
            // HTTPS / TLS Server Startup
            if (!fs.existsSync(this.sslKeyPath) || !fs.existsSync(this.sslCertPath)) {
                console.error(`[SSL ERROR] Missing SSL files at ${this.sslKeyPath} or ${this.sslCertPath}.`);
                console.error(`[SSL HINT] Generate a dev cert with: openssl req -x509 -newkey rsa:2048 -nodes -sha256 -subj "/CN=localhost" -keyout key.pem -out cert.pem`);
                process.exit(1);
            }

            const tlsOptions = {
                key: fs.readFileSync(this.sslKeyPath),
                cert: fs.readFileSync(this.sslCertPath)
            };

            this.server = https.createServer(tlsOptions, requestHandler);
        } else {
            // Standard HTTP Server Startup
            this.server = http.createServer(requestHandler);
        }
        
        // Hand-rolled zero-dependency WebSocket server integration
        this.wss = new WebSocketServer({ server: this.server });
        this.wss.wireToProxy(this);

        this.server.listen(port, host, () => {
            const proto = this.useTls ? 'https' : 'http';
            console.log(`[SYSTEM] FlowBalance Proxy listening on ${proto}://${host}:${port} | Algorithm: ${this.algorithm}`);
            console.log(`[SYSTEM] Live Dashboard available at ${proto}://${host}:${port}/dashboard`);
            console.log(`[SYSTEM] Rate Limiter: ${this.rateLimiter.rps} req/s (Burst: ${this.rateLimiter.burst})`);
            console.log(`[SYSTEM] Circuit Breaker: Trip after ${this.circuitBreaker.failureThreshold} consecutive failures`);
            console.log(`[SYSTEM] Request Tracer: Ring buffer tracking last ${this.tracer.maxTraces} requests`);
        });

        this.startHealthChecks();
    }

    startHealthChecks() {
        // Run health checks every 2.5 seconds
        this.healthCheckInterval = setInterval(() => {
            this.backends.forEach(backend => this.checkHealth(backend));
        }, 2500);
    }

    checkHealth(backend) {
        const startTime = Date.now();
        const req = http.request({
            host: backend.host,
            port: backend.port,
            path: '/health',
            method: 'GET',
            timeout: 2000
        }, (res) => {
            if (res.statusCode === 200) {
                this.markHealthy(backend, Date.now() - startTime);
            } else {
                this.markUnhealthy(backend);
            }
            res.on('data', () => {}); 
        });

        req.on('error', () => {
            this.markUnhealthy(backend);
        });
        
        req.on('timeout', () => {
            req.destroy();
            this.markUnhealthy(backend);
        });

        req.end();
    }

    markHealthy(backend, latency) {
        backend.latency = backend.latency === 0 ? latency : Math.round(backend.latency * 0.8 + latency * 0.2);
        backend.failures = 0;

        if (!backend.isHealthy) {
            backend.isHealthy = true;
            this.emit('healthChange', { backendId: backend.id, status: 'healthy', latency: backend.latency });
        }
    }

    markUnhealthy(backend) {
        backend.failures += 1;
        if (backend.failures >= 2 && backend.isHealthy) {
            backend.isHealthy = false;
            this.emit('healthChange', { backendId: backend.id, status: 'unhealthy', latency: backend.latency });
        }
    }

    /**
     * Get backends that are BOTH healthy per periodic health check
     * AND allowed by the real-time circuit breaker state machine.
     */
    getAvailableBackends() {
        return this.backends.filter(b => b.isHealthy && this.circuitBreaker.canExecute(b.id));
    }

    selectBackend() {
        const available = this.getAvailableBackends();
        if (available.length === 0) return null;

        if (this.algorithm === 'least-connections') {
            return available.reduce((min, b) => b.activeConnections < min.activeConnections ? b : min, available[0]);
        } else {
            const backend = available[this.rrIndex % available.length];
            this.rrIndex = (this.rrIndex + 1) % available.length;
            return backend;
        }
    }

    getClientIp(req) {
        const forwarded = req.headers['x-forwarded-for'];
        if (forwarded) {
            return forwarded.split(',')[0].trim();
        }
        return req.socket.remoteAddress || '127.0.0.1';
    }

    // Backend & Traffic Process Management Subsystem
    startBackend(port) {
        port = parseInt(port, 10);
        if (this.managedProcesses.has(port)) {
            return { success: true, message: `Backend ${port} already running`, port };
        }
        const backendScript = path.join(__dirname, 'backend.js');
        const child = fork(backendScript, [port.toString()], {
            stdio: ['ignore', 'pipe', 'pipe', 'ipc']
        });
        if (child.stdout) child.stdout.on('data', (d) => console.log(`[B:${port}] ${d.toString().trim()}`));
        if (child.stderr) child.stderr.on('data', (d) => console.error(`[B:${port} ERR] ${d.toString().trim()}`));
        child.on('exit', () => {
            console.log(`[SYSTEM] Backend ${port} process exited.`);
            this.managedProcesses.delete(port);
            const b = this.backends.find(x => x.port === port);
            if (b) this.markUnhealthy(b);
        });
        this.managedProcesses.set(port, child);
        console.log(`[SYSTEM] Started backend server on port ${port} (PID: ${child.pid})`);
        return { success: true, message: `Backend ${port} started`, port, pid: child.pid };
    }

    stopBackend(port) {
        port = parseInt(port, 10);
        const child = this.managedProcesses.get(port);
        if (child) {
            child.kill('SIGTERM');
            this.managedProcesses.delete(port);
            const b = this.backends.find(x => x.port === port);
            if (b) this.markUnhealthy(b);
            console.log(`[SYSTEM] Stopped backend server on port ${port}`);
            return { success: true, message: `Backend ${port} stopped`, port };
        }
        return { success: false, message: `Backend ${port} not running under management`, port };
    }

    toggleBackend(port) {
        port = parseInt(port, 10);
        if (this.managedProcesses.has(port)) {
            return this.stopBackend(port);
        } else {
            return this.startBackend(port);
        }
    }

    startTraffic(targetUrl) {
        if (this.trafficProcess) {
            return { success: true, message: 'Traffic generator is already running' };
        }
        const target = targetUrl || `http://127.0.0.1:${this.server ? this.server.address().port : 8080}/api/traffic`;
        const trafficScript = path.join(__dirname, 'traffic-generator.js');
        const child = fork(trafficScript, [target], {
            stdio: ['ignore', 'pipe', 'pipe', 'ipc']
        });
        if (child.stdout) child.stdout.on('data', (d) => console.log(`[TRAFFIC] ${d.toString().trim()}`));
        if (child.stderr) child.stderr.on('data', (d) => console.error(`[TRAFFIC ERR] ${d.toString().trim()}`));
        child.on('exit', () => {
            console.log('[SYSTEM] Traffic generator stopped.');
            this.trafficProcess = null;
        });
        this.trafficProcess = child;
        console.log(`[SYSTEM] Traffic generator started (PID: ${child.pid}) -> Target: ${target}`);
        return { success: true, message: 'Traffic generator started', pid: child.pid };
    }

    stopTraffic() {
        if (this.trafficProcess) {
            this.trafficProcess.kill('SIGTERM');
            this.trafficProcess = null;
            console.log('[SYSTEM] Traffic generator stopped.');
            return { success: true, message: 'Traffic generator stopped' };
        }
        return { success: false, message: 'Traffic generator is not running' };
    }

    toggleTraffic(targetUrl) {
        if (this.trafficProcess) {
            return this.stopTraffic();
        } else {
            return this.startTraffic(targetUrl);
        }
    }

    getControlStatus() {
        const backends = {};
        for (const b of this.backends) {
            backends[b.port] = {
                running: this.managedProcesses.has(b.port),
                healthy: b.isHealthy,
                latency: b.latency,
                activeConnections: b.activeConnections
            };
        }
        return {
            algorithm: this.algorithm,
            backends,
            trafficRunning: !!this.trafficProcess
        };
    }

    stop() {
        if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
        for (const [port, child] of this.managedProcesses.entries()) {
            child.kill();
        }
        if (this.trafficProcess) this.trafficProcess.kill();
        if (this.server) this.server.close();
    }

    handleIncomingRequest(req, res) {
        const cleanUrl = req.url.split('?')[0];

        // 1. Static Dashboard Delivery
        if (cleanUrl === '/' || cleanUrl === '/dashboard') {
            const dashboardPath = path.join(__dirname, 'dashboard.html');
            if (fs.existsSync(dashboardPath)) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                fs.createReadStream(dashboardPath).pipe(res);
                return;
            }
        }

        // 1.5 Server & Traffic Control API Endpoints
        if (cleanUrl.startsWith('/api/control/')) {
            const urlObj = new URL(req.url, 'http://localhost');
            const action = cleanUrl.replace('/api/control/', '');
            const port = parseInt(urlObj.searchParams.get('port'), 10);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            if (action === 'status') {
                res.end(JSON.stringify(this.getControlStatus()));
            } else if (action === 'backend/start' && port) {
                res.end(JSON.stringify(this.startBackend(port)));
            } else if (action === 'backend/stop' && port) {
                res.end(JSON.stringify(this.stopBackend(port)));
            } else if (action === 'backend/toggle' && port) {
                res.end(JSON.stringify(this.toggleBackend(port)));
            } else if (action === 'traffic/start') {
                res.end(JSON.stringify(this.startTraffic()));
            } else if (action === 'traffic/stop') {
                res.end(JSON.stringify(this.stopTraffic()));
            } else if (action === 'traffic/toggle') {
                res.end(JSON.stringify(this.toggleTraffic()));
            } else if (action === 'algorithm') {
                const requestedAlgo = urlObj.searchParams.get('algo');
                if (requestedAlgo && (requestedAlgo === 'round-robin' || requestedAlgo === 'least-connections')) {
                    this.algorithm = requestedAlgo;
                } else {
                    this.algorithm = this.algorithm === 'round-robin' ? 'least-connections' : 'round-robin';
                }
                if (this.wss) {
                    this.wss.broadcast({
                        type: 'init',
                        algorithm: this.algorithm,
                        backends: this.backends.map(b => ({
                            id: b.id,
                            host: b.host,
                            port: b.port,
                            isHealthy: b.isHealthy,
                            circuitState: this.circuitBreaker.getState(b.id),
                            activeConnections: b.activeConnections,
                            latency: b.latency
                        }))
                    });
                }
                res.end(JSON.stringify({ success: true, algorithm: this.algorithm }));
            } else {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unknown control action' }));
            }
            return;
        }

        // 2. Trace Inspection Endpoints (/trace/:requestId and /traces)
        if (cleanUrl.startsWith('/trace/')) {
            const requestedId = cleanUrl.slice('/trace/'.length).trim();
            const trace = this.tracer.getTrace(requestedId);
            if (trace) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(trace, null, 2));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Trace not found', requestId: requestedId }));
            }
            return;
        }

        if (cleanUrl === '/traces') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(this.tracer.getRecentTraces(50), null, 2));
            return;
        }

        // 3. Generate Request ID and initialize lifecycle trace
        const requestId = this.tracer.generateId(req);
        res.setHeader('X-Request-Id', requestId);
        const clientIp = this.getClientIp(req);

        this.tracer.startTrace(requestId, {
            method: req.method,
            path: req.url,
            clientIp: clientIp,
            headers: req.headers
        });

        // 4. Token Bucket Rate Limiting Stage
        const rateCheck = this.rateLimiter.consume(clientIp);
        this.tracer.addStage(requestId, 'rate_limit_check', {
            allowed: rateCheck.allowed,
            remainingTokens: rateCheck.remaining,
            retryAfter: rateCheck.retryAfter
        });

        if (!rateCheck.allowed) {
            res.writeHead(429, {
                'Content-Type': 'application/json',
                'Retry-After': rateCheck.retryAfter
            });
            res.end(JSON.stringify({
                error: 'Too Many Requests',
                requestId: requestId,
                message: `Rate limit exceeded. Try again in ${rateCheck.retryAfter}s.`,
                retryAfter: rateCheck.retryAfter
            }));
            this.tracer.completeTrace(requestId, 429, { blocked: 'rate_limited' });
            this.logRequest(req, null, 429, 0, requestId);
            return;
        }

        // 5. Buffer body for failover resilience & forward
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const bodyBuffer = Buffer.concat(chunks);
            this.performProxyRequest(req, res, 0, bodyBuffer, requestId);
        });
    }

    performProxyRequest(req, res, retryCount, bodyBuffer, requestId) {
        const startTime = Date.now();
        const backend = this.selectBackend();
        const breakerState = backend ? this.circuitBreaker.getState(backend.id) : 'NONE';

        // Trace Circuit Breaker Check Stage
        this.tracer.addStage(requestId, 'circuit_check', {
            attempt: retryCount + 1,
            backend: backend ? backend.id : null,
            circuitState: breakerState,
            isHealthy: backend ? backend.isHealthy : false
        });

        if (!backend) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: 'Service Unavailable: No healthy backends with closed circuit',
                requestId: requestId,
                breakerStates: this.circuitBreaker.getAllStates()
            }));
            this.tracer.completeTrace(requestId, 503, { error: 'no_available_backends' });
            this.logRequest(req, null, 503, Date.now() - startTime, requestId);
            return;
        }

        backend.activeConnections += 1;

        // Trace Routing Dispatch Stage
        this.tracer.addStage(requestId, 'routed', {
            backend: backend.id,
            attempt: retryCount + 1,
            algorithm: this.algorithm
        });

        this.emit('requestRouted', {
            requestId: requestId,
            method: req.method,
            path: req.url,
            backendId: backend.id,
            algorithm: this.algorithm
        });

        const headers = { ...req.headers, 'x-request-id': requestId };
        const options = {
            host: backend.host,
            port: backend.port,
            path: req.url,
            method: req.method,
            headers: headers
        };

        const proxyReq = http.request(options, (proxyRes) => {
            const duration = Date.now() - startTime;

            // Trace Backend Response Stage
            this.tracer.addStage(requestId, 'backend_response', {
                status: proxyRes.statusCode,
                latency: duration,
                backend: backend.id,
                headers: Object.keys(proxyRes.headers)
            });

            if (proxyRes.statusCode >= 500) {
                // Record failure in Circuit Breaker on 5xx errors
                this.circuitBreaker.recordFailure(backend.id);

                if (retryCount < 1) {
                    // Graceful failover to another backend
                    backend.activeConnections -= 1;
                    proxyRes.on('data', () => {});
                    this.tracer.addStage(requestId, 'failover_retry', {
                        previousBackend: backend.id,
                        status: proxyRes.statusCode
                    });
                    return this.performProxyRequest(req, res, retryCount + 1, bodyBuffer, requestId);
                }
            } else {
                // Record success in Circuit Breaker on 2xx/3xx/4xx
                this.circuitBreaker.recordSuccess(backend.id);
            }

            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res);

            proxyRes.on('end', () => {
                backend.activeConnections -= 1;
                this.tracer.completeTrace(requestId, proxyRes.statusCode, { backend: backend.id });
                this.logRequest(req, backend, proxyRes.statusCode, duration, requestId);
                this.emit('requestCompleted', {
                    requestId: requestId,
                    method: req.method,
                    path: req.url,
                    backendId: backend.id,
                    statusCode: proxyRes.statusCode,
                    duration: duration
                });
            });
        });

        proxyReq.on('error', (err) => {
            const duration = Date.now() - startTime;
            backend.activeConnections -= 1;
            this.circuitBreaker.recordFailure(backend.id);

            this.tracer.addStage(requestId, 'backend_error', {
                error: err.message,
                backend: backend.id,
                attempt: retryCount + 1
            });

            if (retryCount < 1) {
                // Graceful failover on connection error
                this.tracer.addStage(requestId, 'failover_retry', {
                    previousBackend: backend.id,
                    error: err.message
                });
                this.performProxyRequest(req, res, retryCount + 1, bodyBuffer, requestId);
            } else {
                if (!res.headersSent) {
                    res.writeHead(502, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Bad Gateway', requestId: requestId }));
                }
                this.tracer.completeTrace(requestId, 502, { backend: backend.id, error: err.message });
                this.logRequest(req, backend, 502, duration, requestId);
            }
        });

        if (bodyBuffer.length > 0) {
            proxyReq.write(bodyBuffer);
        }
        proxyReq.end();
    }

    logRequest(req, backend, statusCode, duration, requestId) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            requestId: requestId || null,
            method: req.method,
            path: req.url,
            backend: backend ? backend.id : null,
            responseTime: duration,
            statusCode: statusCode
        };
        console.log(JSON.stringify(logEntry));
    }
}

// Standalone execution entrypoint
if (require.main === module) {
    let backends = [
        { host: '127.0.0.1', port: 3001 },
        { host: '127.0.0.1', port: 3002 },
        { host: '127.0.0.1', port: 3003 }
    ];

    if (process.env.BACKENDS) {
        backends = process.env.BACKENDS.split(',').map(entry => {
            const trimmed = entry.trim().replace(/^https?:\/\//, '');
            const parts = trimmed.split(':');
            return { host: parts[0] || '127.0.0.1', port: parseInt(parts[1], 10) || 80 };
        });
    }
    
    const algorithm = process.env.ALGORITHM || 'round-robin';
    const proxy = new ProxyServer(backends, { algorithm });
    
    const port = parseInt(process.env.PORT, 10) || 8080;
    const host = process.env.HOST || '0.0.0.0';
    proxy.start(port, host);

    // Auto-start backend child processes unless running external backends
    if (process.env.AUTO_START_BACKENDS !== 'false' && !process.env.BACKENDS) {
        backends.forEach(b => proxy.startBackend(b.port));
    }

    // Graceful process exit
    const cleanup = () => {
        console.log('\n[SYSTEM] Gracefully shutting down FlowBalance and child processes...');
        proxy.stop();
        process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
}

module.exports = ProxyServer;



