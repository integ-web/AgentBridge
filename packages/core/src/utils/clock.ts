/**
 * Monotonic clock provider for consistent timestamps across the application.
 * All timestamps are ISO 8601 strings in UTC.
 */
export function now(): string {
  return new Date().toISOString();
}

/**
 * Get high-resolution monotonic time in milliseconds.
 * Useful for measuring durations without wall-clock drift.
 */
export function monotonicMs(): number {
  return performance.now();
}

/**
 * Check if an ISO timestamp is expired relative to now.
 */
export function isExpired(isoTimestamp: string): boolean {
  return new Date(isoTimestamp).getTime() < Date.now();
}

/**
 * Compute duration in milliseconds between two ISO timestamps.
 */
export function durationMs(start: string, end: string): number {
  return new Date(end).getTime() - new Date(start).getTime();
}

/**
 * Add milliseconds to an ISO timestamp and return new ISO string.
 */
export function addMs(isoTimestamp: string, ms: number): string {
  return new Date(new Date(isoTimestamp).getTime() + ms).toISOString();
}
