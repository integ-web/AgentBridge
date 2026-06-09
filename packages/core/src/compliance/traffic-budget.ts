import type { TrafficBudgetConfig } from '../types.js';
import { createLogger } from '../utils/index.js';

const logger = createLogger('TrafficBudget');

/** One minute in milliseconds. */
const ONE_MINUTE_MS = 60_000;

// ─── Local types ─────────────────────────────────────────────────────────────

/** Per-origin runtime counters. */
interface OriginCounters {
  /** Timestamps of requests inside the current sliding window. */
  requestTimestamps: number[];
  /** Currently active concurrent task count. */
  concurrentTasks: number;
  /** Cumulative retry count (since last reset). */
  retryCount: number;
  /** Timestamp (epoch ms) of the last retry, used for backoff. */
  lastRetryAt: number;
}

/** Result returned by {@link TrafficBudget.checkBudget}. */
export interface BudgetCheckResult {
  /** Whether the request is allowed under the current budget. */
  allowed: boolean;
  /** Human-readable reason for the decision. */
  reason: string;
  /** If denied, suggested delay in ms before retrying. */
  retryAfterMs?: number;
}

// ─── Budget tracker ──────────────────────────────────────────────────────────

/**
 * Tracks per-origin traffic counters and enforces
 * {@link TrafficBudgetConfig} limits.
 *
 * Uses a sliding-window algorithm: only requests whose timestamps
 * fall within the last 60 000 ms are counted against
 * `requests_per_minute`.
 */
export class TrafficBudget {
  /**
   * Budget configurations keyed by origin.
   * Must be populated before checking — if missing a budget
   * will be treated as unlimited.
   */
  private readonly configs: Map<string, TrafficBudgetConfig> = new Map();

  /** Runtime counters keyed by origin. */
  private readonly counters: Map<string, OriginCounters> = new Map();

  // ── Config management ──────────────────────────────────────────────────

  /**
   * Register (or replace) the budget configuration for an origin.
   *
   * @param config - The traffic budget to enforce.
   */
  setBudget(config: TrafficBudgetConfig): void {
    this.configs.set(config.origin, config);
    logger.debug('Budget set', {
      origin: config.origin,
      rpm: String(config.requests_per_minute),
    });
  }

  /**
   * Retrieve the budget configuration for an origin, if set.
   *
   * @param origin - The target origin.
   */
  getBudget(origin: string): TrafficBudgetConfig | undefined {
    return this.configs.get(origin);
  }

  // ── Budget enforcement ─────────────────────────────────────────────────

  /**
   * Determine whether a request to the given origin is currently
   * allowed.
   *
   * @param origin - The origin to check.
   * @returns A {@link BudgetCheckResult} describing the verdict.
   */
  checkBudget(origin: string): BudgetCheckResult {
    const config = this.configs.get(origin);
    if (!config) {
      // No budget configured → allow by default
      return { allowed: true, reason: 'No traffic budget configured for this origin.' };
    }

    const counters = this.ensureCounters(origin);
    this.pruneWindow(counters);

    // 1. Check requests-per-minute
    if (counters.requestTimestamps.length >= config.requests_per_minute) {
      const oldestInWindow = counters.requestTimestamps[0];
      const retryAfterMs = oldestInWindow + ONE_MINUTE_MS - Date.now();
      logger.warn('RPM limit reached', { origin, rpm: String(config.requests_per_minute) });
      return {
        allowed: false,
        reason: `Rate limit reached: ${config.requests_per_minute} requests per minute for '${origin}'.`,
        retryAfterMs: Math.max(retryAfterMs, 0),
      };
    }

    // 2. Check concurrent tasks
    if (counters.concurrentTasks >= config.max_concurrent_tasks) {
      return {
        allowed: false,
        reason: `Max concurrent tasks (${config.max_concurrent_tasks}) reached for '${origin}'.`,
        retryAfterMs: 1_000,
      };
    }

    // 3. Check retries exceeded
    if (counters.retryCount >= config.max_retries) {
      const backoff = this.computeBackoff(counters.retryCount, config);
      const elapsed = Date.now() - counters.lastRetryAt;
      if (elapsed < backoff) {
        return {
          allowed: false,
          reason: `Max retries (${config.max_retries}) exhausted for '${origin}'. Backing off.`,
          retryAfterMs: backoff - elapsed,
        };
      }
    }

    return { allowed: true, reason: 'Request is within budget.' };
  }

  // ── Recording ──────────────────────────────────────────────────────────

  /**
   * Record a request to the given origin.
   * This advances the sliding-window counter.
   *
   * @param origin - The origin the request was made to.
   */
  recordRequest(origin: string): void {
    const counters = this.ensureCounters(origin);
    counters.requestTimestamps.push(Date.now());
    logger.debug('Request recorded', {
      origin,
      windowSize: String(counters.requestTimestamps.length),
    });
  }

  /**
   * Record a retry to the given origin.
   * Increments the retry counter and captures the timestamp
   * for exponential backoff calculations.
   *
   * @param origin - The origin that triggered a retry.
   * @returns The recommended backoff delay in ms before the next attempt.
   */
  recordRetry(origin: string): number {
    const counters = this.ensureCounters(origin);
    counters.retryCount += 1;
    counters.lastRetryAt = Date.now();

    const config = this.configs.get(origin);
    const backoff = config
      ? this.computeBackoff(counters.retryCount, config)
      : this.computeBackoff(counters.retryCount);

    logger.warn('Retry recorded', {
      origin,
      retryCount: String(counters.retryCount),
      backoffMs: String(backoff),
    });

    return backoff;
  }

  /**
   * Increment the concurrent-task count for an origin.
   *
   * @param origin - The origin to track.
   */
  acquireTask(origin: string): void {
    const counters = this.ensureCounters(origin);
    counters.concurrentTasks += 1;
  }

  /**
   * Decrement the concurrent-task count for an origin.
   *
   * @param origin - The origin to release.
   */
  releaseTask(origin: string): void {
    const counters = this.ensureCounters(origin);
    counters.concurrentTasks = Math.max(counters.concurrentTasks - 1, 0);
  }

  // ── Reset ──────────────────────────────────────────────────────────────

  /**
   * Reset all counters for an origin.
   *
   * @param origin - The origin to reset.
   */
  reset(origin: string): void {
    this.counters.delete(origin);
    logger.info('Counters reset', { origin });
  }

  /**
   * Reset counters for every tracked origin.
   */
  resetAll(): void {
    this.counters.clear();
    logger.info('All counters reset');
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /** Get or create the counters struct for an origin. */
  private ensureCounters(origin: string): OriginCounters {
    let c = this.counters.get(origin);
    if (!c) {
      c = {
        requestTimestamps: [],
        concurrentTasks: 0,
        retryCount: 0,
        lastRetryAt: 0,
      };
      this.counters.set(origin, c);
    }
    return c;
  }

  /**
   * Remove timestamps older than 60 s from the sliding window.
   * Mutates the array in-place for efficiency.
   */
  private pruneWindow(counters: OriginCounters): void {
    const cutoff = Date.now() - ONE_MINUTE_MS;
    // requestTimestamps is in chronological order; drop from front.
    while (
      counters.requestTimestamps.length > 0 &&
      counters.requestTimestamps[0] < cutoff
    ) {
      counters.requestTimestamps.shift();
    }
  }

  /**
   * Compute exponential backoff with jitter.
   *
   * delay = min(base * 2^(attempt−1) + jitter, max)
   */
  private computeBackoff(
    attempt: number,
    config?: TrafficBudgetConfig,
  ): number {
    const base = config?.backoff_base_ms ?? 1_000;
    const max = config?.backoff_max_ms ?? 30_000;
    const exponential = base * Math.pow(2, Math.max(attempt - 1, 0));
    const jitter = Math.random() * base * 0.5;
    return Math.min(exponential + jitter, max);
  }
}
