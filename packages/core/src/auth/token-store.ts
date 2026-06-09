import { randomHex, generateId } from '../utils/index.js';
import { createLogger } from '../utils/index.js';

const logger = createLogger('TokenStore');

/** Default token time-to-live: 24 hours in milliseconds. */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;

// ─── Local types ─────────────────────────────────────────────────────────────

/** Internal representation of a stored token. */
interface StoredToken {
  /** The token value (64-char hex). */
  token: string;
  /** Unique identifier for this token entry. */
  id: string;
  /** Epoch ms when the token was created. */
  createdAt: number;
  /** Epoch ms when the token expires. */
  expiresAt: number;
  /** Whether the token has been explicitly revoked. */
  revoked: boolean;
}

/** Result of a token validation check. */
export interface TokenValidationResult {
  /** Whether the token is valid. */
  valid: boolean;
  /** Human-readable reason for the result. */
  reason: string;
  /** Token ID, if the token was found. */
  tokenId?: string;
}

/** Options for the TokenStore constructor. */
export interface TokenStoreOptions {
  /** Token time-to-live in milliseconds (default: 24 h). */
  ttlMs?: number;
}

// ─── Token Store ─────────────────────────────────────────────────────────────

/**
 * In-memory store for authentication tokens.
 *
 * Tokens are 64-character random hex strings, each associated with a
 * creation timestamp, an expiry, and a revocation flag. The store
 * supports generation, validation, revocation, and atomic rotation.
 */
export class TokenStore {
  private readonly tokens: Map<string, StoredToken> = new Map();
  private readonly ttlMs: number;

  constructor(options?: TokenStoreOptions) {
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  }

  /**
   * Generate a new authentication token.
   *
   * The token is a cryptographically random 64-character hex string.
   *
   * @returns The generated token string.
   */
  generate(): string {
    const token = randomHex(32); // 32 bytes → 64 hex chars
    const now = Date.now();

    const entry: StoredToken = {
      token,
      id: generateId(),
      createdAt: now,
      expiresAt: now + this.ttlMs,
      revoked: false,
    };

    this.tokens.set(token, entry);
    logger.info('Token generated', { tokenId: entry.id });
    return token;
  }

  /**
   * Validate whether a token is known, not revoked, and not expired.
   *
   * @param token - The token string to validate.
   * @returns A {@link TokenValidationResult}.
   */
  validate(token: string): TokenValidationResult {
    const entry = this.tokens.get(token);

    if (!entry) {
      return { valid: false, reason: 'Token not found.' };
    }

    if (entry.revoked) {
      return {
        valid: false,
        reason: 'Token has been revoked.',
        tokenId: entry.id,
      };
    }

    if (Date.now() > entry.expiresAt) {
      return {
        valid: false,
        reason: 'Token has expired.',
        tokenId: entry.id,
      };
    }

    return {
      valid: true,
      reason: 'Token is valid.',
      tokenId: entry.id,
    };
  }

  /**
   * Revoke a token so it can no longer be used.
   *
   * @param token - The token string to revoke.
   * @returns `true` if the token was found and revoked, `false` otherwise.
   */
  revoke(token: string): boolean {
    const entry = this.tokens.get(token);
    if (!entry) {
      logger.warn('Revoke called for unknown token');
      return false;
    }

    entry.revoked = true;
    logger.info('Token revoked', { tokenId: entry.id });
    return true;
  }

  /**
   * Atomically rotate: generates a new token and revokes the old one.
   *
   * @param oldToken - The current token to revoke.
   * @returns The newly generated token string.
   */
  rotate(oldToken: string): string {
    this.revoke(oldToken);
    const newToken = this.generate();
    logger.info('Token rotated');
    return newToken;
  }

  /**
   * Remove all expired and revoked tokens from the store.
   * Useful as a periodic housekeeping operation.
   *
   * @returns The number of tokens purged.
   */
  purgeExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of this.tokens) {
      if (entry.revoked || now > entry.expiresAt) {
        this.tokens.delete(key);
        count += 1;
      }
    }
    if (count > 0) {
      logger.info('Purged expired/revoked tokens', { count: String(count) });
    }
    return count;
  }

  /** Return the number of tokens currently in the store (including expired). */
  get size(): number {
    return this.tokens.size;
  }
}
