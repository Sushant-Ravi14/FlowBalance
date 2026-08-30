const http = require('http');
const EventEmitter = require('events');

/**
 * FlowBalance Proxy Server
 * A zero-dependency reverse proxy and load balancer.
 */

class ProxyServer extends EventEmitter {
    /**
     * @param {Array<{host: string, port: number}>} backends 
     * @param {string} algorithm - 'round-robin' or 'least-connections'
     */
    constructor(backends, algorithm = 'round-robin') {
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
        this.algorithm = algorithm;
        this.rrIndex = 0;
        this.healthCheckInterval = null;
    }
    start(port = 8080) {
        this.server = http.createServer((req, res) => this.handleIncomingRequest(req, res));
        this.server.listen(port, () => {
            console.log(`[SYSTEM] FlowBalance Proxy listening on port ${port} | Algorithm: ${this.algorithm}`);
        });
        this.startHealthChecks();
    }

    startHealthChecks() {
        // Run health checks every 3 seconds
        this.healthCheckInterval = setInterval(() => {
            this.backends.forEach(backend => this.checkHealth(backend));
        }, 3000);
    }

    checkHealth(backend) {
        const startTime = Date.now();
        const req = http.request({
            host: backend.host,
            port: backend.port,
            path: '/health',
            method: 'GET',
            timeout: 2000 // 2 second timeout for health checks
        }, (res) => {
            if (res.statusCode === 200) {
                this.markHealthy(backend, Date.now() - startTime);
            } else {
                this.markUnhealthy(backend);
            }
            // Consume data to free memory
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
        // Simple moving average for latency tracking
        backend.latency = backend.latency === 0 ? latency : Math.round(backend.latency * 0.8 + latency * 0.2);
        backend.failures = 0;

        if (!backend.isHealthy) {
            backend.isHealthy = true;
        }
    }

    markUnhealthy(backend) {
        backend.failures += 1;
        // Mark unhealthy after 2 consecutive failures
        if (backend.failures >= 2 && backend.isHealthy) {
            backend.isHealthy = false;
        }
    }

    getHealthyBackends() {
        return this.backends.filter(b => b.isHealthy);
    }

    selectBackend() {
        const healthy = this.getHealthyBackends();
        if (healthy.length === 0) return null;

        if (this.algorithm === 'least-connections') {
            return healthy.reduce((min, b) => b.activeConnections < min.activeConnections ? b : min, healthy[0]);
        } else {
            // Default to round-robin
            const backend = healthy[this.rrIndex % healthy.length];
            this.rrIndex = (this.rrIndex + 1) % healthy.length;
            return backend;
        }
    }

    handleIncomingRequest(req, res) {
        this.performProxyRequest(req, res, 0);
    }

    performProxyRequest(req, res, retryCount) {
        const startTime = Date.now();
        const backend = this.selectBackend();
        
        if (!backend) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Service Unavailable: No healthy backends' }));
            this.logRequest(req, null, 503, Date.now() - startTime);
            return;
        }

        backend.activeConnections += 1;

        const options = {
            host: backend.host,
            port: backend.port,
            path: req.url,
            method: req.method,
            headers: req.headers
        };

        const proxyReq = http.request(options, (proxyRes) => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res);

            proxyRes.on('end', () => {
                backend.activeConnections -= 1;
                const duration = Date.now() - startTime;
                this.logRequest(req, backend, proxyRes.statusCode, duration);
            });
        });

        proxyReq.on('error', (err) => {
            backend.activeConnections -= 1;
            if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Bad Gateway' }));
            }
            const duration = Date.now() - startTime;
            this.logRequest(req, backend, 502, duration);
        });

        req.pipe(proxyReq);
    }
}

    logRequest(req, backend, statusCode, duration) {
        // Structured request logging to stdout
        const logEntry = {
            timestamp: new Date().toISOString(),
            method: req.method,
            path: req.url,
            backend: backend ? backend.id : null,
            responseTime: duration,
            statusCode: statusCode
        };
        console.log(JSON.stringify(logEntry));
    }
}

module.exports = ProxyServer;
