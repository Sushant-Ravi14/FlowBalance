const EventEmitter = require('events');

/**
 * FlowBalance Token-Bucket Rate Limiter
 * Implemented with zero external dependencies.
 * Uses native Map, timestamp delta calculation, and EventEmitter.
 * 
 * Replaces: express-rate-limit / rate-limiter-flexible
 */

class TokenBucketRateLimiter extends EventEmitter {
    /**
     * @param {object} options
     * @param {number} options.rps - Refill rate (tokens added per second)
     * @param {number} options.burst - Maximum burst capacity (max tokens in bucket)
     * @param {number} options.cleanupIntervalMs - Interval to prune inactive IPs from memory
     */
    constructor(options = {}) {
        super();
        this.rps = options.rps || 10;
        this.burst = options.burst || 20;
        this.cleanupIntervalMs = options.cleanupIntervalMs || 60000;
        
        // Map: IP -> { tokens: number, lastRefill: number }
        this.buckets = new Map();

        // Background cleanup timer to avoid memory leaks from transient IPs
        this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
        if (this.cleanupTimer.unref) {
            this.cleanupTimer.unref(); // Don't prevent process from exiting
        }
    }

    /**
     * Check if a request from the given IP is allowed under the token bucket policy.
     * @param {string} ip - Client IP address
     * @param {number} tokens - Number of tokens to consume (default 1)
     * @returns {{ allowed: boolean, remaining: number, retryAfter: number }}
     */
    consume(ip, tokens = 1) {
        const now = Date.now();
        let bucket = this.buckets.get(ip);

        if (!bucket) {
            bucket = {
                tokens: this.burst,
                lastRefill: now
            };
            this.buckets.set(ip, bucket);
        } else {
            // Refill tokens based on elapsed time
            const elapsedSec = (now - bucket.lastRefill) / 1000;
            const newTokens = elapsedSec * this.rps;
            bucket.tokens = Math.min(this.burst, bucket.tokens + newTokens);
            bucket.lastRefill = now;
        }

        if (bucket.tokens >= tokens) {
            bucket.tokens -= tokens;
            return {
                allowed: true,
                remaining: Math.floor(bucket.tokens),
                retryAfter: 0
            };
        } else {
            // Calculate seconds until enough tokens are refilled
            const neededTokens = tokens - bucket.tokens;
            const retryAfter = Math.max(1, Math.ceil(neededTokens / this.rps));

            const eventPayload = {
                type: 'rate_limited',
                ip: ip,
                timestamp: now,
                retryAfter: retryAfter,
                rps: this.rps,
                burst: this.burst
            };

            this.emit('rate_limited', eventPayload);

            return {
                allowed: false,
                remaining: 0,
                retryAfter: retryAfter
            };
        }
    }

    /**
     * Inspect current bucket state for an IP (useful for demos and monitoring)
     * @param {string} ip 
     * @returns {{ tokens: number, lastRefill: number } | null}
     */
    inspect(ip) {
        if (!this.buckets.has(ip)) return null;
        const bucket = this.buckets.get(ip);
        const elapsedSec = (Date.now() - bucket.lastRefill) / 1000;
        const currentTokens = Math.min(this.burst, bucket.tokens + elapsedSec * this.rps);
        return {
            tokens: parseFloat(currentTokens.toFixed(2)),
            lastRefill: bucket.lastRefill
        };
    }

    /**
     * Reset bucket for a specific IP
     * @param {string} ip 
     */
    reset(ip) {
        this.buckets.delete(ip);
    }

    /**
     * Reset all tracked IP buckets
     */
    resetAll() {
        this.buckets.clear();
    }

    /**
     * Periodic cleanup of inactive IPs (idle > 5 minutes)
     */
    cleanup() {
        const now = Date.now();
        const maxIdle = 5 * 60 * 1000;
        for (const [ip, bucket] of this.buckets.entries()) {
            if (now - bucket.lastRefill > maxIdle) {
                this.buckets.delete(ip);
            }
        }
    }

    /**
     * Destroy timers
     */
    destroy() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
    }
}

module.exports = TokenBucketRateLimiter;
