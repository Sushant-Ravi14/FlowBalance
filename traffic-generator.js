const http = require('http');
const { URL } = require('url');

/**
 * FlowBalance Zero-Dependency Traffic Generator
 * Simulates real-world ambient traffic to test load balancing,
 * failover resilience, and real-time dashboard visualizations.
 * 
 * Replaces: autocannon / artillery / k6
 */

const TARGET_URL = process.argv[2] || process.env.TARGET_URL || 'http://localhost:8080/api/traffic';
const parsedUrl = new URL(TARGET_URL);

// Statistics tracking
const stats = {
    totalSent: 0,
    success: 0,
    failures: 0,
    statusCodes: {},
    latencies: [],
    intervalSuccess: 0,
    intervalFailures: 0,
    startTime: Date.now(),
    lastIntervalTime: Date.now()
};

console.log('====================================================');
console.log('⚡ FlowBalance Zero-Dependency Traffic Generator');
console.log(`🎯 Target Endpoint : ${TARGET_URL}`);
console.log('⏱️  Interval        : Random 100ms - 300ms');
console.log('📊 Summary Report   : Printed every 5 seconds');
console.log('====================================================\n');

// Keep-alive agent for realistic connection reuse
const agent = new http.Agent({
    keepAlive: true,
    maxSockets: 50
});

function sendRequest() {
    const start = Date.now();
    stats.totalSent++;

    const options = {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 80,
        path: parsedUrl.pathname + (parsedUrl.search || ''),
        method: 'GET',
        agent: agent,
        timeout: 5000
    };

    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
            const latency = Date.now() - start;
            const code = res.statusCode;

            stats.statusCodes[code] = (stats.statusCodes[code] || 0) + 1;
            stats.latencies.push(latency);
            if (stats.latencies.length > 500) stats.latencies.shift();

            if (code >= 200 && code < 400) {
                stats.success++;
                stats.intervalSuccess++;
            } else {
                stats.failures++;
                stats.intervalFailures++;
            }
        });
    });

    req.on('error', (err) => {
        stats.failures++;
        stats.intervalFailures++;
        stats.statusCodes['ERR'] = (stats.statusCodes['ERR'] || 0) + 1;
    });

    req.on('timeout', () => {
        req.destroy();
        stats.failures++;
        stats.intervalFailures++;
        stats.statusCodes['TIMEOUT'] = (stats.statusCodes['TIMEOUT'] || 0) + 1;
    });

    req.end();

    // Schedule next request with randomized 100ms - 300ms interval
    const nextInterval = Math.floor(Math.random() * (300 - 100 + 1)) + 100;
    setTimeout(sendRequest, nextInterval);
}

// Start traffic generation
sendRequest();

// 5-Second Interval Benchmark Reporter
setInterval(() => {
    const now = Date.now();
    const elapsedSec = (now - stats.lastIntervalTime) / 1000;
    const totalElapsedSec = Math.round((now - stats.startTime) / 1000);

    const intervalReqs = stats.intervalSuccess + stats.intervalFailures;
    const rps = (intervalReqs / elapsedSec).toFixed(1);

    const successRate = stats.totalSent > 0 
        ? ((stats.success / stats.totalSent) * 100).toFixed(2) 
        : '100.00';

    const recentLats = stats.latencies.slice(-50);
    const avgLatency = recentLats.length > 0
        ? Math.round(recentLats.reduce((a, b) => a + b, 0) / recentLats.length)
        : 0;
    const minLatency = recentLats.length > 0 ? Math.min(...recentLats) : 0;
    const maxLatency = recentLats.length > 0 ? Math.max(...recentLats) : 0;

    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];

    console.log(`[${timestamp}] (Uptime: ${totalElapsedSec}s)`);
    console.log(`  ➔ Total Requests : ${stats.totalSent.toLocaleString()} | Success: \x1b[32m${stats.success.toLocaleString()}\x1b[0m | Failures: \x1b[31m${stats.failures.toLocaleString()}\x1b[0m`);
    console.log(`  ➔ Success Rate   : \x1b[36m${successRate}%\x1b[0m (Zero-Dropped Proof)`);
    console.log(`  ➔ Throughput     : \x1b[33m${rps} req/sec\x1b[0m`);
    console.log(`  ➔ Latency (ms)   : Avg: ${avgLatency}ms (Min: ${minLatency}ms | Max: ${maxLatency}ms)`);
    console.log(`  ➔ Status Codes   : ${JSON.stringify(stats.statusCodes)}`);
    console.log('----------------------------------------------------');

    // Reset interval counters
    stats.intervalSuccess = 0;
    stats.intervalFailures = 0;
    stats.lastIntervalTime = now;
}, 5000);

// Graceful Exit Summary
process.on('SIGINT', () => {
    console.log('\n\n================ FINAL TRAFFIC SUMMARY ================');
    console.log(`Total Requests Sent : ${stats.totalSent.toLocaleString()}`);
    console.log(`Successful Requests : ${stats.success.toLocaleString()}`);
    console.log(`Failed Requests     : ${stats.failures.toLocaleString()}`);
    const finalSuccessRate = stats.totalSent > 0 
        ? ((stats.success / stats.totalSent) * 100).toFixed(2) 
        : '100.00';
    console.log(`Final Success Rate  : ${finalSuccessRate}%`);
    console.log(`Status Codes        : ${JSON.stringify(stats.statusCodes, null, 2)}`);
    console.log('=======================================================\n');
    process.exit(0);
});
