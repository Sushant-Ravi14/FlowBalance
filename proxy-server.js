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

    getHealthyBackends() {
        return this.backends.filter(b => b.isHealthy);
    }

    selectBackend() {
        const healthy = this.getHealthyBackends();
        if (healthy.length === 0) return null;

        // Default to round-robin
        const backend = healthy[this.rrIndex % healthy.length];
        this.rrIndex = (this.rrIndex + 1) % healthy.length;
        return backend;
    }

    handleIncomingRequest(req, res) {
        res.writeHead(200);
        res.end('Proxy Running');
    }
}

module.exports = ProxyServer;
