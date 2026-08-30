const http = require('http');

const PORT = parseInt(process.argv[2], 10) || 3000;

const server = http.createServer((req, res) => {
    // Health check endpoint
    if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
    }
    // Simulate backend processing latency (50-300ms)
    const latency = Math.floor(Math.random() * (300 - 50 + 1) + 50);

    setTimeout(() => {
        // Only return 200 for demo purposes. Can easily be modified to simulate failures.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            message: 'Hello from FlowBalance backend',
            port: PORT,
            latency: latency,
            method: req.method,
            path: req.url,
            timestamp: new Date().toISOString()
        }));
    }, latency);
});

server.listen(PORT, () => {
    console.log(`[BACKEND] Dummy server listening on port ${PORT}`);
});
