import { TokenStore } from './token-store.js';
import type { TokenStoreOptions } from './token-store.js';
import { generateId, now } from '../utils/index.js';
import { createLogger } from '../utils/index.js';
import { AgentBridgeError } from '../types.js';

const logger = createLogger('BridgeAuth');

/** Default session duration: 8 hours. */
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1_000;

// ─── Types ───────────────────────────────────────────────────────────────────

/** The type of client connecting to AgentBridge. */
export type ClientType = 'extension' | 'sdk' | 'cli' | 'admin';

/** A live, authenticated session. */
export interface Session {
  /** Unique session identifier. */
  id: string;
  /** The ID of the connecting client. */
  clientId: string;
  /** Client type classification. */
  clientType: ClientType;
  /** ISO 8601 timestamp of session creation. */
  createdAt: string;
  /** Epoch ms when the session expires. */
  expiresAt: number;
  /** Whether the session has been explicitly terminated. */
  terminated: boolean;
}

/** Result of an authentication attempt. */
export interface AuthResult {
  /** Whether authentication succeeded. */
  authenticated: boolean;
  /** Reason for the result. */
  reason: string;
}

/** Result of session validation. */
export interface SessionValidationResult {
  /** Whether the session is valid. */
  valid: boolean;
  /** The session, if valid. */
  session?: Session;
  /** Reason for the result. */
  reason: string;
}

/** Options for BridgeAuth. */
export interface BridgeAuthOptions {
  /** Options forwarded to the underlying {@link TokenStore}. */
  tokenStoreOptions?: TokenStoreOptions;
  /** Session time-to-live in milliseconds (default: 8 h). */
  sessionTtlMs?: number;
}

// ─── Auth manager ────────────────────────────────────────────────────────────

/**
 * Authentication manager for AgentBridge connections.
 *
 * Manages two layers:
 * 1. **Connection tokens** — validated via {@link TokenStore}.
 * 2. **Sessions** — created after successful token auth, scoped to a
 *    client ID and client type. Sessions have their own TTL and can be
 *    ended explicitly.
 */
export class BridgeAuth {
  private readonly tokenStore: TokenStore;
  private readonly sessions: Map<string, Session> = new Map();
  private readonly sessionTtlMs: number;

  constructor(options?: BridgeAuthOptions) {
    this.tokenStore = new TokenStore(options?.tokenStoreOptions);
    this.sessionTtlMs = options?.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  }

  // ── Token management (delegate) ────────────────────────────────────────

  /**
   * Generate a new connection token.
   * Delegates to the underlying {@link TokenStore}.
   *
   * @returns The generated token string.
   */
  generateToken(): string {
    return this.tokenStore.generate();
  }

  /**
   * Revoke a connection token.
   *
   * @param token - The token to revoke.
   * @returns `true` if revoked.
   */
  revokeToken(token: string): boolean {
    return this.tokenStore.revoke(token);
  }

  /**
   * Rotate a connection token (revoke old, issue new).
   *
   * @param oldToken - The current token.
   * @returns The new token.
   */
  rotateToken(oldToken: string): string {
    return this.tokenStore.rotate(oldToken);
  }

  // ── Authentication ─────────────────────────────────────────────────────

  /**
   * Authenticate a connection token.
   *
   * @param token - The token presented by the connecting client.
   * @returns An {@link AuthResult} indicating success or failure.
   */
  authenticate(token: string): AuthResult {
    const result = this.tokenStore.validate(token);

    if (!result.valid) {
      logger.warn('Authentication failed', { reason: result.reason });
      return { authenticated: false, reason: result.reason };
    }

    logger.info('Authentication succeeded', { tokenId: result.tokenId ?? 'unknown' });
    return { authenticated: true, reason: 'Token is valid.' };
  }

  // ── Session management ─────────────────────────────────────────────────

  /**
   * Create an authenticated session for a client.
   *
   * @param clientId   - Unique identifier of the connecting client.
   * @param clientType - The type of client (`extension`, `sdk`, `cli`, `admin`).
   * @returns The newly created {@link Session}.
   * @throws {AgentBridgeError} if clientId or clientType is invalid.
   */
  createSession(clientId: string, clientType: ClientType): Session {
    if (!clientId || clientId.trim().length === 0) {
      throw new AgentBridgeError(
        'clientId must be a non-empty string.',
        'INVALID_CLIENT_ID',
      );
    }

    const validTypes: ClientType[] = ['extension', 'sdk', 'cli', 'admin'];
    if (!validTypes.includes(clientType)) {
      throw new AgentBridgeError(
        `Invalid clientType '${clientType}'. Must be one of: ${validTypes.join(', ')}.`,
        'INVALID_CLIENT_TYPE',
      );
    }

    const session: Session = {
      id: generateId(),
      clientId,
      clientType,
      createdAt: now(),
      expiresAt: Date.now() + this.sessionTtlMs,
      terminated: false,
    };

    this.sessions.set(session.id, session);

    logger.info('Session created', {
      sessionId: session.id,
      clientId,
      clientType,
    });

    return session;
  }

  /**
   * Validate an existing session by its ID.
   *
   * @param sessionId - The session ID to validate.
   * @returns A {@link SessionValidationResult}.
   */
  validateSession(sessionId: string): SessionValidationResult {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return { valid: false, reason: 'Session not found.' };
    }

    if (session.terminated) {
      return { valid: false, reason: 'Session has been terminated.', session };
    }

    if (Date.now() > session.expiresAt) {
      return { valid: false, reason: 'Session has expired.', session };
    }

    return { valid: true, reason: 'Session is valid.', session };
  }

  /**
   * End (terminate) a session.
   *
   * @param sessionId - The session ID to end.
   * @returns `true` if the session was found and terminated.
   */
  endSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn('endSession called for unknown session', { sessionId });
      return false;
    }

    session.terminated = true;
    logger.info('Session ended', { sessionId, clientId: session.clientId });
    return true;
  }

  /**
   * List all active (non-terminated, non-expired) sessions.
   *
   * @returns An array of active {@link Session} objects.
   */
  listActiveSessions(): Session[] {
    const nowMs = Date.now();
    return Array.from(this.sessions.values()).filter(
      (s) => !s.terminated && nowMs <= s.expiresAt,
    );
  }

  /**
   * Remove all expired and terminated sessions from memory.
   *
   * @returns The number of sessions purged.
   */
  purgeSessions(): number {
    const nowMs = Date.now();
    let count = 0;
    for (const [id, session] of this.sessions) {
      if (session.terminated || nowMs > session.expiresAt) {
        this.sessions.delete(id);
        count += 1;
      }
    }
    if (count > 0) {
      logger.info('Purged sessions', { count: String(count) });
    }
    return count;
  }

  /** Return the total number of sessions (including expired). */
  get sessionCount(): number {
    return this.sessions.size;
  }
}
