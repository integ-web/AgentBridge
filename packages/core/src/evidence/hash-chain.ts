import { sha256 } from '../utils/index.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Deterministic genesis hash — the immutable root of every chain. */
const GENESIS_HASH = sha256('agentbridge:evidence:genesis:v1');

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single entry in the hash chain. */
export interface HashChainEntry {
  /** Zero-based index within the chain. */
  readonly index: number;
  /** ISO-8601 timestamp when the entry was appended. */
  readonly timestamp: string;
  /** SHA-256 hash of the serialised payload. */
  readonly payload_hash: string;
  /** Hash of the immediately preceding entry (genesis hash for index 0). */
  readonly previous_hash: string;
  /** SHA-256(previous_hash + payload_hash) — the chain link. */
  readonly chain_hash: string;
}

// ─── HashChain ───────────────────────────────────────────────────────────────

/**
 * Append-only SHA-256 hash chain for tamper-evident audit logging.
 *
 * Each entry's `chain_hash` is derived from the concatenation of the
 * previous entry's `chain_hash` and the current entry's `payload_hash`,
 * ensuring that any mutation of an earlier entry invalidates all
 * subsequent hashes.
 *
 * @example
 * ```ts
 * const chain = new HashChain();
 * chain.append({ action: 'task.created', id: 't-1' });
 * chain.append({ action: 'permission.granted', id: 'p-1' });
 * console.log(chain.verify()); // true
 * ```
 */
export class HashChain {
  /** Internal ordered store of chain entries. */
  private readonly entries: HashChainEntry[] = [];

  /**
   * Append a new payload to the chain.
   *
   * The payload is deterministically serialised (sorted keys) before hashing
   * so that logically identical objects always produce the same hash.
   *
   * @param payload - Arbitrary JSON-serialisable data to record.
   * @returns The newly created {@link HashChainEntry}.
   */
  append(payload: Record<string, unknown>): HashChainEntry {
    const previousHash = this.entries.length > 0
      ? this.entries[this.entries.length - 1]!.chain_hash
      : GENESIS_HASH;

    const payloadHash = sha256(this.deterministicSerialise(payload));
    const chainHash = sha256(previousHash + payloadHash);

    const entry: HashChainEntry = {
      index: this.entries.length,
      timestamp: new Date().toISOString(),
      payload_hash: payloadHash,
      previous_hash: previousHash,
      chain_hash: chainHash,
    };

    this.entries.push(entry);
    return entry;
  }

  /**
   * Verify the integrity of the entire chain.
   *
   * Walks every entry, recomputing `chain_hash` from `previous_hash` and
   * `payload_hash`, and checks linkage between consecutive entries.
   *
   * @returns `true` if the chain is intact, `false` if tampering is detected.
   */
  verify(): boolean {
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i]!;

      // 1. Verify linkage — previous_hash must match prior entry (or genesis).
      const expectedPrevious = i === 0
        ? GENESIS_HASH
        : this.entries[i - 1]!.chain_hash;

      if (entry.previous_hash !== expectedPrevious) {
        return false;
      }

      // 2. Verify chain_hash is correctly derived.
      const expectedChainHash = sha256(entry.previous_hash + entry.payload_hash);
      if (entry.chain_hash !== expectedChainHash) {
        return false;
      }
    }
    return true;
  }

  /**
   * Return a shallow copy of all chain entries.
   *
   * The returned array is a copy — callers cannot mutate the internal chain.
   */
  getChain(): readonly HashChainEntry[] {
    return [...this.entries];
  }

  /**
   * Return the hash of the most recent entry, or the genesis hash if empty.
   */
  getLatestHash(): string {
    return this.entries.length > 0
      ? this.entries[this.entries.length - 1]!.chain_hash
      : GENESIS_HASH;
  }

  /**
   * Return the number of entries in the chain.
   */
  get length(): number {
    return this.entries.length;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Deterministically serialise an object by recursively sorting keys.
   * This ensures that `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` produce
   * identical strings and therefore identical hashes.
   */
  private deterministicSerialise(obj: unknown): string {
    return JSON.stringify(this.sortKeys(obj));
  }

  /**
   * Recursively sort object keys for deterministic serialisation.
   */
  private sortKeys(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.sortKeys(item));
    }
    if (typeof value === 'object') {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        sorted[key] = this.sortKeys((value as Record<string, unknown>)[key]);
      }
      return sorted;
    }
    return value;
  }
}
