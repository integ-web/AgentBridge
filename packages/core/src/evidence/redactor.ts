import type { Snapshot, RedactionInfo } from '../types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A named regular-expression pattern used for redaction. */
export interface RedactionPattern {
  /** Human-readable pattern name (e.g. "credit_card"). */
  readonly name: string;
  /** The regex used for matching sensitive content. */
  readonly regex: RegExp;
}

/** Placeholder injected into redacted output. */
const REDACTED = '[REDACTED]';

// ─── Built-in Patterns ──────────────────────────────────────────────────────

/**
 * Default set of patterns covering the most common secret/PII categories.
 *
 * Each regex is crafted to minimise false positives while still catching
 * the dominant real-world formats.  All patterns use the global and
 * case-insensitive flags so a single `replace` call handles every match.
 */
const BUILTIN_PATTERNS: readonly RedactionPattern[] = [
  // ── Credentials ────────────────────────────────────────────────────────
  {
    name: 'password',
    regex: /(?:password|passwd|pwd)\s*[=:]\s*\S+/gi,
  },
  {
    name: 'token',
    regex: /(?:token|access_token|refresh_token)\s*[=:]\s*\S+/gi,
  },
  {
    name: 'bearer_token',
    regex: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  },
  {
    name: 'auth_header',
    regex: /(?:authorization|x-api-key|x-auth-token)\s*[=:]\s*\S+/gi,
  },
  {
    name: 'api_key',
    regex: /(?:api[_-]?key|apikey|api[_-]?secret)\s*[=:]\s*\S+/gi,
  },
  {
    name: 'session_id',
    regex: /(?:session[_-]?id|sid|jsessionid|phpsessid|csrf[_-]?token)\s*[=:]\s*\S+/gi,
  },

  // ── PII ────────────────────────────────────────────────────────────────
  {
    name: 'credit_card',
    regex: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
  },
  {
    name: 'ssn',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    name: 'email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },

  // ── Generic long secrets (base64 / hex tokens ≥ 40 chars) ─────────────
  {
    name: 'long_secret',
    regex: /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,
  },
];

// ─── Sensitive-key detection ─────────────────────────────────────────────────

/** Object keys whose *values* should be unconditionally redacted. */
const SENSITIVE_KEY_TOKENS: readonly string[] = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'api_key',
  'apikey',
  'api-key',
  'authorization',
  'auth',
  'session_id',
  'sessionid',
  'session-id',
  'cookie',
  'set-cookie',
  'csrf',
  'ssn',
  'credit_card',
  'creditcard',
  'card_number',
  'cvv',
  'private_key',
  'privatekey',
  'access_token',
  'refresh_token',
];

/**
 * Returns `true` when the key name implies its value is sensitive.
 */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_TOKENS.some((tok) => lower.includes(tok));
}

// ─── Redactor ────────────────────────────────────────────────────────────────

/**
 * Redacts sensitive data from strings, objects, and {@link Snapshot} instances.
 *
 * Ships with a comprehensive set of built-in patterns covering passwords,
 * tokens, auth headers, credit-card numbers, SSNs, emails, API keys, bearer
 * tokens, and session IDs.  Additional patterns may be registered at runtime
 * via {@link Redactor.addPattern}.
 *
 * @example
 * ```ts
 * const r = new Redactor();
 * r.redactString('password=hunter2');
 * // → '[REDACTED]'
 *
 * r.redactObject({ username: 'alice', token: 'abc123' });
 * // → { username: 'alice', token: '[REDACTED]' }
 * ```
 */
export class Redactor {
  /** All active patterns (built-ins + custom). */
  private readonly patterns: RedactionPattern[];

  constructor() {
    // Clone built-ins so each Redactor instance is independent.
    this.patterns = [...BUILTIN_PATTERNS];
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Register a custom redaction pattern.
   *
   * @param name  - Human-readable label for audit trails.
   * @param regex - Pattern to match.  Must use the `g` flag for full coverage.
   */
  addPattern(name: string, regex: RegExp): void {
    // Ensure global flag is set so `replace` hits every occurrence.
    const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
    this.patterns.push({ name, regex: new RegExp(regex.source, flags) });
  }

  /**
   * Redact all sensitive patterns from a plain string.
   *
   * @param text - Input text that may contain sensitive data.
   * @returns The text with all matches replaced by `[REDACTED]`.
   */
  redactString(text: string): string {
    let result = text;
    for (const { regex } of this.patterns) {
      // Reset lastIndex for stateful regexes.
      regex.lastIndex = 0;
      result = result.replace(regex, REDACTED);
    }
    return result;
  }

  /**
   * Deep-redact an arbitrary object.
   *
   * - Keys whose names imply sensitivity have their values replaced outright.
   * - String values are passed through {@link Redactor.redactString}.
   * - Nested objects and arrays are traversed recursively.
   *
   * @param obj - The object to redact.  Not mutated — a new object is returned.
   * @returns A deep copy with sensitive data replaced by `[REDACTED]`.
   */
  redactObject<T extends Record<string, unknown>>(obj: T): T {
    return this.deepRedact(obj) as T;
  }

  /**
   * Redact a {@link Snapshot} object's sensitive fields.
   *
   * Handles the Snapshot-specific structure:
   * - Form-field values that are marked `redacted` or whose names are
   *   sensitive are replaced.
   * - Element ref values are scanned for secrets.
   * - A {@link RedactionInfo} entry is appended for every field touched.
   *
   * @param snapshot - The snapshot to sanitise.  Not mutated.
   * @returns A new Snapshot with all sensitive data replaced and updated
   *          `redactions` array.
   */
  redactSnapshot(snapshot: Snapshot): Snapshot {
    const redactions: RedactionInfo[] = [...snapshot.redactions];

    // ── Redact form field values ──────────────────────────────────────────
    const forms = snapshot.forms.map((form) => ({
      ...form,
      fields: form.fields.map((field) => {
        if (field.value === undefined) return field;

        const shouldRedact =
          field.redacted ||
          isSensitiveKey(field.name) ||
          (field.type === 'password') ||
          this.containsSensitive(field.value);

        if (shouldRedact) {
          redactions.push({
            ref: field.ref,
            field: field.name,
            reason: this.classifyReason(field.name, field.type),
            pattern: this.matchedPatternName(field.value) ?? field.type,
          });
          return { ...field, value: REDACTED, redacted: true };
        }
        return field;
      }),
    }));

    // ── Redact element ref values ─────────────────────────────────────────
    const refs = snapshot.refs.map((elRef) => {
      if (elRef.value === undefined) return elRef;
      if (this.containsSensitive(elRef.value) || isSensitiveKey(elRef.name)) {
        redactions.push({
          ref: elRef.ref,
          field: elRef.name,
          reason: this.classifyReason(elRef.name, elRef.role),
          pattern: this.matchedPatternName(elRef.value) ?? 'element_value',
        });
        return { ...elRef, value: REDACTED };
      }
      return elRef;
    });

    // ── Redact element ref attributes ─────────────────────────────────────
    const refsWithRedactedAttrs = refs.map((elRef) => {
      if (!elRef.attributes) return elRef;
      const redactedAttrs: Record<string, string> = {};
      let changed = false;
      for (const [key, val] of Object.entries(elRef.attributes)) {
        if (isSensitiveKey(key) || this.containsSensitive(val)) {
          redactedAttrs[key] = REDACTED;
          changed = true;
        } else {
          redactedAttrs[key] = val;
        }
      }
      return changed ? { ...elRef, attributes: redactedAttrs } : elRef;
    });

    return {
      ...snapshot,
      forms,
      refs: refsWithRedactedAttrs,
      redactions,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /** Check whether any pattern matches inside `text`. */
  private containsSensitive(text: string): boolean {
    for (const { regex } of this.patterns) {
      regex.lastIndex = 0;
      if (regex.test(text)) {
        return true;
      }
    }
    return false;
  }

  /** Return the name of the first matching pattern, or `undefined`. */
  private matchedPatternName(text: string): string | undefined {
    for (const { name, regex } of this.patterns) {
      regex.lastIndex = 0;
      if (regex.test(text)) {
        return name;
      }
    }
    return undefined;
  }

  /** Map key/type hints to the closest {@link RedactionInfo} reason. */
  private classifyReason(
    name: string,
    type: string,
  ): RedactionInfo['reason'] {
    const lower = (name + ' ' + type).toLowerCase();
    if (lower.includes('password') || lower.includes('passwd') || lower.includes('pwd')) return 'password';
    if (lower.includes('token') || lower.includes('session')) return 'token';
    if (lower.includes('auth') || lower.includes('bearer')) return 'auth_header';
    if (lower.includes('secret') || lower.includes('api_key') || lower.includes('apikey')) return 'secret';
    if (lower.includes('card') || lower.includes('cvv') || lower.includes('payment')) return 'payment';
    if (lower.includes('ssn') || lower.includes('social') || lower.includes('email')) return 'pii';
    return 'enterprise_sensitive';
  }

  /**
   * Recursively redact an unknown value.
   *
   * - Sensitive-key objects have their values replaced outright.
   * - Strings are scanned for pattern matches.
   * - Arrays and nested objects are traversed.
   */
  private deepRedact(value: unknown): unknown {
    if (value === null || value === undefined) return value;

    if (typeof value === 'string') {
      return this.redactString(value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.deepRedact(item));
    }

    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        if (isSensitiveKey(key)) {
          result[key] = REDACTED;
        } else {
          result[key] = this.deepRedact(val);
        }
      }
      return result;
    }

    // Primitives (number, boolean) pass through unchanged.
    return value;
  }
}
