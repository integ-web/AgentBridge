import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Generate a unique ID using crypto.randomUUID().
 * Uses the standard UUID v4 format.
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Generate a short ID for display purposes (first 8 chars of UUID).
 */
export function generateShortId(): string {
  return generateId().slice(0, 8);
}

/**
 * Compute SHA-256 hash of a string.
 */
export function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf-8').digest('hex');
}

/**
 * Compute HMAC-SHA256 of data with a key.
 */
export function hmacSha256(key: string, data: string): string {
  return createHmac('sha256', key).update(data, 'utf-8').digest('hex');
}

/**
 * Generate cryptographically secure random bytes as hex string.
 */
export function randomHex(length: number = 32): string {
  return randomBytes(length).toString('hex');
}

/**
 * Hash an object deterministically by sorting keys and JSON-stringifying.
 */
export function hashObject(obj: Record<string, unknown>): string {
  const sorted = JSON.stringify(obj, Object.keys(obj).sort());
  return sha256(sorted);
}
