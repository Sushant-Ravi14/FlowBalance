const http = require('http');

const PORT = parseInt(process.argv[2], 10) || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        message: 'Hello from FlowBalance backend',
        port: PORT
    }));
});

server.listen(PORT, () => {
    console.log(`[BACKEND] Dummy server listening on port ${PORT}`);
});
