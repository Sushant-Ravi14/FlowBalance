const http = require('http');

class ProxyServer {
    start(port = 8080) {
        this.server = http.createServer((req, res) => this.handleIncomingRequest(req, res));
        this.server.listen(port, () => {
            console.log(`[SYSTEM] FlowBalance Proxy listening on port ${port}`);
        });
    }

    handleIncomingRequest(req, res) {
        res.writeHead(200);
        res.end('Proxy Running');
    }
}

module.exports = ProxyServer;
