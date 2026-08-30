const EventEmitter = require('events');

/**
 * FlowBalance Backend Circuit Breaker
 * Implemented with zero external dependencies.
 * 
 * Replaces: opossum / brakes / cockatiel
 * 
 * WHY THIS IS DIFFERENT FROM HEALTH CHECKS:
 * -----------------------------------------
 * - Health Checkers periodically poll a dedicated lightweight endpoint (e.g. /health).
 *   A backend may report 200 OK on /health while failing on real database-heavy queries,
 *   crashing on specific payloads, or timing out under high concurrent load.
 * 
 * - Circuit Breakers intercept real production traffic. When a backend starts throwing 5xx errors
 *   or connection timeouts on actual user requests, the circuit trips to OPEN immediately.
 *   This "fails fast", prevents cascading failover storms, protects dying backends from
 *   overload, and stops clients from waiting for socket timeouts.
 */

const STATES = {
    CLOSED: 'CLOSED',       // Normal operation: traffic flows freely
    OPEN: 'OPEN',           // Tripped: traffic is blocked, fails fast
    HALF_OPEN: 'HALF_OPEN'  // Canary test: allows limited probe requests to verify recovery
};

class CircuitBreakerManager extends EventEmitter {
    /**
     * @param {object} options
     * @param {number} options.failureThreshold - Number of consecutive failures to trip OPEN (default 5)
     * @param {number} options.cooldownMs - Cooldown duration before attempting HALF_OPEN (default 10000ms)
     * @param {number} options.halfOpenSuccessThreshold - Successful probes required to re-close circuit (default 2)
     */
    constructor(options = {}) {
        super();
        this.failureThreshold = options.failureThreshold || 5;
        this.cooldownMs = options.cooldownMs || 10000;
        this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold || 2;

        // Map: backendId -> { state, consecutiveFailures, consecutiveSuccesses, nextAttempt, activeProbes }
        this.breakers = new Map();
    }

    /**
     * Initialize or get breaker entry for a backend
     * @param {string} backendId 
     */
    getBreaker(backendId) {
        if (!this.breakers.has(backendId)) {
            this.breakers.set(backendId, {
                state: STATES.CLOSED,
                consecutiveFailures: 0,
                consecutiveSuccesses: 0,
                nextAttempt: 0,
                activeProbes: 0
            });
        }
        return this.breakers.get(backendId);
    }

    /**
     * Check if a request can be dispatched to the backend.
     * @param {string} backendId 
     * @returns {boolean}
     */
    canExecute(backendId) {
        const breaker = this.getBreaker(backendId);
        const now = Date.now();

        if (breaker.state === STATES.CLOSED) {
            return true;
        }

        if (breaker.state === STATES.OPEN) {
            if (now >= breaker.nextAttempt) {
                // Cooldown period expired -> transition to HALF_OPEN probe mode
                this.transition(backendId, STATES.HALF_OPEN);
                breaker.activeProbes = 1;
                return true;
            }
            return false; // Still in cooldown, fail fast
        }

        if (breaker.state === STATES.HALF_OPEN) {
            // Allow up to halfOpenSuccessThreshold probe requests concurrently
            if (breaker.activeProbes < this.halfOpenSuccessThreshold) {
                breaker.activeProbes += 1;
                return true;
            }
            return false;
        }

        return false;
    }

    /**
     * Record a successful request completion for a backend
     * @param {string} backendId 
     */
    recordSuccess(backendId) {
        const breaker = this.getBreaker(backendId);

        if (breaker.state === STATES.HALF_OPEN) {
            breaker.consecutiveSuccesses += 1;
            breaker.activeProbes = Math.max(0, breaker.activeProbes - 1);

            // If enough canary probes succeed, restore circuit to CLOSED
            if (breaker.consecutiveSuccesses >= this.halfOpenSuccessThreshold) {
                breaker.consecutiveFailures = 0;
                breaker.consecutiveSuccesses = 0;
                this.transition(backendId, STATES.CLOSED);
            }
        } else if (breaker.state === STATES.CLOSED) {
            breaker.consecutiveFailures = 0;
        }
    }

    /**
     * Record a failed request (connection drop, 5xx, or timeout) for a backend
     * @param {string} backendId 
     */
    recordFailure(backendId) {
        const breaker = this.getBreaker(backendId);
        const now = Date.now();

        if (breaker.state === STATES.HALF_OPEN) {
            // A probe request failed: immediate trip back to OPEN with fresh cooldown
            breaker.activeProbes = 0;
            breaker.consecutiveSuccesses = 0;
            breaker.nextAttempt = now + this.cooldownMs;
            this.transition(backendId, STATES.OPEN);
        } else if (breaker.state === STATES.CLOSED) {
            breaker.consecutiveFailures += 1;
            if (breaker.consecutiveFailures >= this.failureThreshold) {
                breaker.nextAttempt = now + this.cooldownMs;
                this.transition(backendId, STATES.OPEN);
            }
        }
    }

    /**
     * Transition breaker to a new state and emit event
     * @param {string} backendId 
     * @param {string} newState 
     */
    transition(backendId, newState) {
        const breaker = this.getBreaker(backendId);
        const oldState = breaker.state;
        breaker.state = newState;

        const payload = {
            type: 'circuit_state',
            backend: backendId,
            oldState: oldState,
            state: newState,
            consecutiveFailures: breaker.consecutiveFailures,
            timestamp: Date.now(),
            nextAttempt: breaker.nextAttempt
        };

        this.emit('circuit_state', payload);
    }

    /**
     * Get the current state of a backend circuit breaker
     * @param {string} backendId 
     * @returns {string} 'CLOSED' | 'OPEN' | 'HALF_OPEN'
     */
    getState(backendId) {
        return this.getBreaker(backendId).state;
    }

    /**
     * Inspect all breaker states (for dashboard initial state and diagnostics)
     * @returns {Array<{ backendId: string, state: string, failures: number }>}
     */
    getAllStates() {
        const result = [];
        for (const [id, breaker] of this.breakers.entries()) {
            result.push({
                backendId: id,
                state: breaker.state,
                failures: breaker.consecutiveFailures
            });
        }
        return result;
    }

    /**
     * Manually reset a backend's circuit breaker
     * @param {string} backendId 
     */
    reset(backendId) {
        if (this.breakers.has(backendId)) {
            const breaker = this.breakers.get(backendId);
            breaker.state = STATES.CLOSED;
            breaker.consecutiveFailures = 0;
            breaker.consecutiveSuccesses = 0;
            breaker.activeProbes = 0;
            this.transition(backendId, STATES.CLOSED);
        }
    }
}

CircuitBreakerManager.STATES = STATES;
module.exports = CircuitBreakerManager;
