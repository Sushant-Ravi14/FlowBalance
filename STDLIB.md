# FlowBalance Standard Library Replacements

For this zero-dependency hackathon project, we achieved a fully functional reverse proxy and load balancer utilizing only Node.js built-in modules. Below is the mapping of common npm packages to our standard library alternatives:

- **Normally: express / fastify** 
  - **Instead:** `http.createServer` with manual URL parsing and routing. We leverage the raw `http.IncomingMessage` and `http.ServerResponse` streams.
- **Normally: http-proxy / http-proxy-middleware** 
  - **Instead:** Manual request forwarding using `http.request`. We buffer the incoming request streams to support our graceful failover/retry mechanism natively.
- **Normally: axios / node-fetch** 
  - **Instead:** `http.request` used natively for executing periodic health checks and resolving backend server status.
- **Normally: winston / pino** 
  - **Instead:** `console.log` paired with `JSON.stringify` to output structured JSON logs directly to `process.stdout`.
- **Normally: eventemitter3** 
  - **Instead:** The Node.js built-in `events.EventEmitter`. `ProxyServer` extends `EventEmitter` to provide decoupled hooks for request routing, health status changes, and request completion tracking.
- **Normally: async** 
  - **Instead:** Native Promises and async/await constructs for asynchronous control flow where required (along with standard callback-based networking functions).
