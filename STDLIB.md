# FlowBalance Standard Library Replacements

For this zero-dependency hackathon project, we achieved a fully functional reverse proxy, load balancer, real-time RFC 6455 WebSocket hub, and visual live dashboard utilizing only Node.js and browser built-in capabilities. Below is the mapping of common npm packages to our standard library alternatives:

- **Normally: express / fastify** 
  - **Instead:** `http.createServer` with manual URL parsing and routing. We leverage raw `http.IncomingMessage` and `http.ServerResponse` streams.
- **Normally: ws / socket.io**
  - **Instead:** Hand-rolled RFC 6455 WebSocket Server using Node's `crypto` module (SHA-1 + GUID handshake computation), raw `net.Socket` HTTP upgrade handling, binary frame buffering/parsing, and bitwise XOR payload masking/unmasking.
- **Normally: http-proxy / http-proxy-middleware** 
  - **Instead:** Manual request forwarding using `http.request`. We buffer the incoming request streams to support our graceful failover/retry mechanism natively.
- **Normally: chart.js / d3 / echarts**
  - **Instead:** Hand-drawn HTML5 Canvas 2D rendering loop (`requestAnimationFrame`) with custom bezier interpolation, gradient fills, and coordinate scaling for live real-time latency graphs.
- **Normally: serve-static / express.static**
  - **Instead:** Node.js built-in `fs.createReadStream` piped directly into `http.ServerResponse` with content-type headers.
- **Normally: body-parser / raw-body**
  - **Instead:** Node.js stream events (`req.on('data')` + `Buffer.concat`) to buffer request payloads natively.
- **Normally: axios / node-fetch** 
  - **Instead:** `http.request` used natively for executing periodic health checks and resolving backend server status.
- **Normally: winston / pino** 
  - **Instead:** `console.log` paired with `JSON.stringify` to output structured JSON logs directly to `process.stdout`.
- **Normally: eventemitter3** 
  - **Instead:** The Node.js built-in `events.EventEmitter`. `ProxyServer` and `WebSocketServer` extend `EventEmitter` to provide decoupled hooks for request routing, health status changes, and request completion tracking.
- **Normally: async** 
  - **Instead:** Native Promises and async/await constructs for asynchronous control flow where required (along with standard callback-based networking functions).
- **Normally: autocannon / artillery / k6**
  - **Instead:** Native `http.request` with keep-alive agent pooling, randomized interval scheduling (`setTimeout`), and rolling terminal statistics aggregation.
- **Normally: express-rate-limit / rate-limiter-flexible**
  - **Instead:** Native JavaScript `Map` + timestamp delta token-bucket algorithm (`rate-limiter.js`) with configurable refill rate (RPS), burst headroom, and HTTP 429 `Retry-After` headers.
- **Normally: opossum / brakes / cockatiel**
  - **Instead:** Custom 3-state Circuit Breaker state machine (`circuit-breaker.js`) implementing `CLOSED`, `OPEN`, and `HALF_OPEN` canary probes with configurable failure thresholds and cooldown timers.
- **Normally: greenlock / certbot-wrapper / spdy**
  - **Instead:** Node.js built-in `https` and `tls` modules (`https.createServer({ key, cert })`) paired with an `openssl`-generated self-signed certificate for local development and testing.
- **Normally: Jaeger / Zipkin SDK / OpenTelemetry / uuid**
  - **Instead:** `crypto.randomUUID()` + in-memory Map-based request timeline lifecycle tracking (`tracer.js`) + custom `/trace/:requestId` diagnostic endpoint and dashboard waterfall visualization.

