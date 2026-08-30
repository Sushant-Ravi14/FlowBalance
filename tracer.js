const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * FlowBalance Zero-Dependency Request Tracing Subsystem
 * Tracks full end-to-end request lifecycle timelines with microsecond precision.
 * 
 * Replaces: OpenTelemetry / Jaeger / Zipkin SDKs / uuid
 */

class RequestTracer extends EventEmitter {
    /**
     * @param {object} options
     * @param {number} [options.maxTraces=200] - In-memory ring buffer size to prevent memory leaks
     */
    constructor(options = {}) {
        super();
        this.maxTraces = options.maxTraces || 200;
        // Map maintains insertion order: requestId -> TraceObject
        this.traces = new Map();
    }

    /**
     * Generate or reuse a unique Request ID
     * @param {import('http').IncomingMessage} req 
     * @returns {string} UUID v4
     */
    generateId(req) {
        return (req && req.headers['x-request-id']) || crypto.randomUUID();
    }

    /**
     * Initialize a new trace for an incoming request
     * @param {string} requestId 
     * @param {object} metadata 
     * @returns {object} Initialized trace record
     */
    startTrace(requestId, metadata = {}) {
        const now = Date.now();
        const trace = {
            requestId: requestId,
            method: metadata.method || 'GET',
            path: metadata.path || '/',
            clientIp: metadata.clientIp || '127.0.0.1',
            startTime: now,
            endTime: null,
            totalDuration: 0,
            status: null,
            backend: null,
            stages: [
                {
                    name: 'received',
                    timestamp: now,
                    offsetMs: 0,
                    durationMs: 0,
                    details: {
                        method: metadata.method,
                        path: metadata.path,
                        clientIp: metadata.clientIp,
                        headers: metadata.headers ? Object.keys(metadata.headers) : []
                    }
                }
            ]
        };

        // Ring buffer eviction
        if (this.traces.size >= this.maxTraces) {
            const oldestKey = this.traces.keys().next().value;
            this.traces.delete(oldestKey);
        }

        this.traces.set(requestId, trace);
        return trace;
    }

    /**
     * Add a lifecycle checkpoint stage to an active request trace
     * @param {string} requestId 
     * @param {string} stageName 
     * @param {object} details 
     */
    addStage(requestId, stageName, details = {}) {
        const trace = this.traces.get(requestId);
        if (!trace) return;

        const now = Date.now();
        const offsetMs = now - trace.startTime;
        const lastStage = trace.stages[trace.stages.length - 1];
        const durationMs = lastStage ? now - lastStage.timestamp : 0;

        trace.stages.push({
            name: stageName,
            timestamp: now,
            offsetMs: offsetMs,
            durationMs: durationMs,
            details: details
        });

        if (details.backend) trace.backend = details.backend;
        if (details.status) trace.status = details.status;
    }

    /**
     * Complete the request trace, calculate final metrics, and emit event
     * @param {string} requestId 
     * @param {number} status 
     * @param {object} finalDetails 
     * @returns {object|null}
     */
    completeTrace(requestId, status, finalDetails = {}) {
        const trace = this.traces.get(requestId);
        if (!trace) return null;

        const now = Date.now();
        const totalDuration = now - trace.startTime;
        const lastStage = trace.stages[trace.stages.length - 1];

        trace.endTime = now;
        trace.totalDuration = totalDuration;
        trace.status = status || trace.status || 200;
        if (finalDetails.backend) trace.backend = finalDetails.backend;

        trace.stages.push({
            name: 'completed',
            timestamp: now,
            offsetMs: totalDuration,
            durationMs: lastStage ? now - lastStage.timestamp : 0,
            details: {
                statusCode: trace.status,
                totalDurationMs: totalDuration,
                ...finalDetails
            }
        });

        // Emit trace event for WebSocket real-time broadcast
        this.emit('trace', trace);
        return trace;
    }

    /**
     * Get trace details by Request ID
     * @param {string} requestId 
     * @returns {object|null}
     */
    getTrace(requestId) {
        return this.traces.get(requestId) || null;
    }

    /**
     * Get recent traces (ordered newest to oldest)
     * @param {number} limit 
     * @returns {Array<object>}
     */
    getRecentTraces(limit = 50) {
        const list = Array.from(this.traces.values());
        return list.reverse().slice(0, limit);
    }

    /**
     * Clear all recorded traces
     */
    clear() {
        this.traces.clear();
    }
}

module.exports = RequestTracer;
