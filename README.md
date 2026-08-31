# ⚡ FlowBalance

> **High-Performance, Zero-Dependency Reverse Proxy, Load Balancer & Real-Time Cyberpunk Observability Hub for Node.js.**

![FlowBalance Dashboard Preview](./dashboard-preview.png)

---

## 📌 The Core Problem

In modern production architectures, running services on a **single server is a catastrophic single point of failure**:
1. **Unplanned Outages & Crashes**: When a backend server dies or throws unhandled errors, client requests drop immediately, returning hard connection errors to end users.
2. **Traffic Spikes & Cascading Failures**: Sudden bursts of traffic overwhelm single instances, exhausting event loops and causing complete service degradation.
3. **Heavy Dependency Bloat & Supply Chain Vulnerabilities**: Traditional load balancers and observability suites rely on dozens of external npm packages (`express`, `ws`, `http-proxy`, `opossum`, `express-rate-limit`, `jaeger-client`, `chart.js`), introducing security risks, version conflicts, and runtime overhead.

---

## 🚀 The Solution: FlowBalance

**FlowBalance** solves all of these challenges natively. Built from the ground up using **STRICTLY ZERO runtime npm dependencies** — powered entirely by Node.js built-in standard library modules (`http`, `https`, `tls`, `net`, `crypto`, `fs`, `events`, `url`) and native browser APIs (HTML5 Canvas 2D, WebSocket RFC 6455).

### 🌟 Key Capabilities

- 🔄 **Intelligent Load Balancing & Failover**: Dynamically routes traffic across backend clusters using **Round-Robin** or **Least-Connections** algorithms. Buffers in-flight request streams in memory to execute **zero-dropped-request failover retries** if a backend dies mid-flight.
- ⚡ **Hand-Rolled RFC 6455 WebSocket Hub**: Built directly on top of raw `net.Socket` streams — implements SHA-1 + GUID handshake negotiation, binary frame encoding/decoding, bitwise XOR client payload unmasking, and live event broadcasting.
- 🛡️ **Token Bucket Rate Limiter**: High-precision token replenishment engine with configurable RPS and burst capacity. Responds with HTTP `429 Too Many Requests` and standard `Retry-After` headers while auto-pruning stale IP state.
- 🔌 **3-State Circuit Breaker**: Prevents cascading failures with `CLOSED`, `OPEN`, and `HALF_OPEN` state transitions, automatic cooldown timers, and canary probe requests.
- 🔍 **Distributed Request Tracing & Waterfall Visualizer**: Stamps every request with native `crypto.randomUUID()` (`X-Request-Id`), tracking stage offsets and latencies across `received`, `rate_limit_check`, `circuit_check`, `routed`, `backend_response`, and `completed`.
- 📊 **Real-Time Canvas 2D Cyberpunk Dashboard**: 60 FPS visual topology graph with animated request particle physics, smooth bezier latency timeline graphs, live event log stream, and interactive trace waterfall breakdowns.
- 🚦 **Ambient Load Testing Tool**: Native traffic generator with keep-alive HTTP agent connection pooling and live terminal metrics aggregation.

---

## 🏛️ System Architecture

```
                                  +--------------------------------------------------+
                                  |                   Client Request                 |
                                  +--------------------------------------------------+
                                                           |
                                                           v
                                         +------------------------------------+
                                         |     FlowBalance Reverse Proxy      |
                                         |         (Port :8080)               |
                                         +------------------------------------+
                                                           |
                      +------------------------------------+------------------------------------+
                      |                                    |                                    |
                      v                                    v                                    v
     +----------------------------------+ +----------------------------------+ +----------------------------------+
     |     1. Request ID Tracer         | |   2. Token Bucket Rate Limiter   | |    3. Circuit Breaker Manager    |
     |   Generates crypto.randomUUID()  | |   Enforces RPS & Burst Limits    | |   CLOSED -> OPEN -> HALF_OPEN    |
     +----------------------------------+ +----------------------------------+ +----------------------------------+
                      |                                    |                                    |
                      +------------------------------------+------------------------------------+
                                                           |
                                                           v
                                         +------------------------------------+
                                         |     Load Balancer & Dispatch       |
                                         | (Round-Robin / Least-Connections)  |
                                         +------------------------------------+
                                                           |
                            +------------------------------+------------------------------+
                            |                                                             |
                            v                                                             v
             +------------------------------+                              +------------------------------+
             |      Backend Node A (:3001)  |                              |      Backend Node B (:3002)  |
             +------------------------------+                              +------------------------------+
                            |                                                             |
                            +------------------------------+------------------------------+
                                                           |
                                                           v
                                         +------------------------------------+
                                         |  Hand-Rolled RFC 6455 WebSocket    |
                                         |          Broadcaster               |
                                         +------------------------------------+
                                                           |
                                                           v
                                         +------------------------------------+
                                         |     Live Cyberpunk Dashboard       |
                                         |   (Canvas 2D Topology & Waterfall) |
                                         +------------------------------------+
```

---

## 📦 Zero-Dependency Proof: Standard Library Mappings

Every single tier of FlowBalance replaces common npm packages with pure Node.js standard library primitives:

| Traditional npm Package | FlowBalance Standard Library Replacement | Implementation Details |
|---|---|---|
| `express` / `fastify` | `http.createServer` / `https.createServer` | Raw `http.IncomingMessage` & `http.ServerResponse` stream routing |
| `ws` / `socket.io` | `net.Socket` + `crypto` | RFC 6455 handshake (SHA-1 + GUID), binary frame buffering, XOR unmasking |
| `http-proxy` / `http-proxy-middleware` | `http.request` | In-memory chunk buffering (`Buffer.concat`) for seamless mid-flight retries |
| `chart.js` / `d3.js` / `echarts` | HTML5 Canvas 2D Context | Custom bezier curves, neon gradient fills, 60 FPS `requestAnimationFrame` |
| `serve-static` | `fs.createReadStream` | Direct filesystem streaming piped into HTTP responses |
| `body-parser` / `raw-body` | Node.js Stream Events | Native `req.on('data')` chunk accumulation |
| `axios` / `node-fetch` | `http.request` | Periodic `/health` probe polling with timeout handling |
| `winston` / `pino` | `console.log` + `JSON.stringify` | Structured JSON log format written directly to `process.stdout` |
| `eventemitter3` | `events.EventEmitter` | Decoupled event-driven pub/sub architecture across subsystems |
| `autocannon` / `artillery` / `k6` | `http.request` + `http.Agent` | Native load generator with keep-alive pooling & terminal reporting |
| `express-rate-limit` | Native `Map` + timestamp deltas | Token bucket replenishment math with automatic stale IP pruning |
| `opossum` / `cockatiel` | State Machine Logic | 3-state Circuit Breaker (`CLOSED`, `OPEN`, `HALF_OPEN`) with cooldowns |
| `jaeger-client` / `uuid` | `crypto.randomUUID()` + `Map` | Ring-buffered request timeline lifecycle tracking & `/trace/:id` endpoint |
| `greenlock` / `tls` | `https` + `tls` | Built-in TLS encryption support with custom key/cert binding |

---

## ⚡ 1-Step Quick Start & Run Guide

FlowBalance now includes a **100% UI-Controllable Demo Deck** — you can run the entire demo from the browser without touching multiple terminals!

### 1. Launch FlowBalance Proxy (Auto-Bootstraps Backends)
```bash
node proxy-server.js
```
*(All 3 backend nodes are automatically managed and ready).*

### 2. Open the Cyberpunk Dashboard
Navigate to **`http://localhost:8080`** in your browser.

---

## 🎬 Zero-Terminal Demo Walkthrough (Perfect for Video Recording)

Everything is controllable right from the top **Control Deck**:

| Step | Action on UI | What to Observe on Screen |
|---|---|---|
| **1. Flood Multi-Traffic** | Click **`🚀 Start Multi-Traffic`** (Choose Normal / Heavy / Turbo) | Glowing particle streams flood from Client → Proxy → All 3 Backends. Throughput counter & 60 FPS bezier latency chart spike in real time. |
| **2. Dynamic Failover** | Click **`Server A (:3001)`** to kill it | Node A turns **RED** on the topology graph. Zero dropped requests — all traffic instantly re-routes to Server B & C. |
| **3. Self-Healing** | Click **`Server A (:3001)`** to restart it | Health checks detect recovery within 2.5s; Node A turns **GREEN** and resumes receiving balanced traffic. |
| **4. Live Algorithm Switching** | Click **`⚡ Proxy :8080`** button | Switches between `ROUND-ROBIN` and `LEAST-CONNECTIONS` in real time with instant visual feedback. |
| **5. Rate Limiting Protection** | Click **`⚡ Burst Test`** button | Token bucket exhausts; Event log displays `429 LIMIT — 🛑 Client rate limited` with `Retry-After` seconds. |
| **6. Distributed Tracing** | Click any Request ID in Traces panel | Real-time horizontal waterfall displays exact microsecond timing breakdown across all 6 lifecycle stages. |

---

## 🛠️ Project Structure

```
FlowBalance/
├── proxy-server.js         # Core reverse proxy, HTTP routing, health checks, failover logic
├── websocket-server.js      # Hand-rolled RFC 6455 WebSocket server (zero libraries)
├── rate-limiter.js         # Token bucket rate limiting engine with auto-pruning
├── circuit-breaker.js      # 3-state circuit breaker state machine (CLOSED/OPEN/HALF_OPEN)
├── tracer.js               # Distributed request tracer (crypto.randomUUID() + ring buffer)
├── traffic-generator.js    # Native ambient load generator & benchmark tool
├── dashboard.html          # Canvas 2D cyberpunk live monitoring UI & waterfall viewer
├── dashboard-preview.png   # Dashboard UI preview screenshot
├── STDLIB.md               # Standard library replacements & dependency defense proof
└── README.md               # Complete project documentation
```

---

## 👨‍💻 Authors & Hackathon Team

- **Swaraj Prajapati** ([@SwarajPrajapati2006](https://github.com/SwarajPrajapati2006)) — *Advanced Features (Rate Limiting, Circuit Breaker, WebSockets), UI Dashboard & Documentation*
- **Sushant Ravi** ([@Sushant-Ravi14](https://github.com/Sushant-Ravi14)) — *Core Proxy Server Architecture, Load Balancing Algorithms, Health Checks, Traffic Generator & Deployment*

---

## 📄 License

MIT License — Built for the Zero-Dependency Hackathon.