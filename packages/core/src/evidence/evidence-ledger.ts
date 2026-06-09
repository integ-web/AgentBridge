import type { AuditEvent } from '../types.js';
import { AuditEventType } from '../types.js';
import { generateId, now } from '../utils/index.js';
import { createLogger } from '../utils/index.js';
import { HashChain } from './hash-chain.js';
import { Redactor } from './redactor.js';

// ─── Logger ──────────────────────────────────────────────────────────────────

const logger = createLogger('EvidenceLedger');

// ─── EvidenceLedger ──────────────────────────────────────────────────────────

/**
 * Append-only evidence ledger that records audit events with
 * tamper-evident hash-chaining and automatic payload redaction.
 *
 * All events are stored in memory.  Persistence (IndexedDB, file,
 * remote sync) is handled by a companion storage layer that consumes
 * the ledger's event stream.
 *
 * @example
 * ```ts
 * const ledger = new EvidenceLedger();
 *
 * ledger.record('task-1', AuditEventType.TaskCreated, {
 *   objective: 'Download invoice',
 *   mode: 'local_attach',
 * });
 *
 * const events = ledger.getEventsForTask('task-1');
 * console.log(ledger.verifyIntegrity()); // true
 * ```
 */
export class EvidenceLedger {
  /** Hash chain that provides tamper-evidence. */
  private readonly chain: HashChain;

  /** In-memory store of all recorded audit events. */
  private readonly events: AuditEvent[] = [];

  /** Index: taskId → event indices for O(1) lookup. */
  private readonly taskIndex: Map<string, number[]> = new Map();

  /** Index: event type → event indices for O(1) lookup. */
  private readonly typeIndex: Map<AuditEventType, number[]> = new Map();

  /** Redactor used to sanitise payloads before storage. */
  private readonly redactor: Redactor;

  constructor(redactor?: Redactor) {
    this.chain = new HashChain();
    this.redactor = redactor ?? new Redactor();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Record an audit event.
   *
   * The payload is redacted, then appended to the hash chain so that its
   * integrity is cryptographically linked to every prior event.
   *
   * @param taskId  - The task this event belongs to.
   * @param type    - The audit event type.
   * @param payload - Arbitrary event data (will be redacted).
   * @returns The persisted {@link AuditEvent}.
   */
  record(
    taskId: string,
    type: AuditEventType,
    payload: Record<string, unknown>,
  ): AuditEvent {
    // 1. Redact the payload.
    const redactedPayload = this.redactor.redactObject(payload);

    // 2. Prepare the chain payload (includes metadata for reproducibility).
    const chainPayload: Record<string, unknown> = {
      task_id: taskId,
      type,
      payload: redactedPayload,
    };

    // 3. Append to hash chain.
    const chainEntry = this.chain.append(chainPayload);

    // 4. Build the AuditEvent.
    const event: AuditEvent = {
      id: generateId(),
      task_id: taskId,
      type,
      timestamp: now(),
      redacted_payload: redactedPayload,
      chain_hash: chainEntry.chain_hash,
      previous_hash: chainEntry.previous_hash,
    };

    // 5. Store and index.
    const idx = this.events.length;
    this.events.push(event);

    // Task index
    const taskEntries = this.taskIndex.get(taskId);
    if (taskEntries) {
      taskEntries.push(idx);
    } else {
      this.taskIndex.set(taskId, [idx]);
    }

    // Type index
    const typeEntries = this.typeIndex.get(type);
    if (typeEntries) {
      typeEntries.push(idx);
    } else {
      this.typeIndex.set(type, [idx]);
    }

    logger.debug('Event recorded', {
      event_id: event.id,
      task_id: taskId,
      type,
    });

    return event;
  }

  /**
   * Retrieve all events associated with a given task, in chronological order.
   *
   * @param taskId - The task identifier.
   * @returns Array of matching events (empty if task has no events).
   */
  getEventsForTask(taskId: string): readonly AuditEvent[] {
    const indices = this.taskIndex.get(taskId);
    if (!indices) return [];
    return indices.map((i) => this.events[i]!);
  }

  /**
   * Retrieve all events of a given type, in chronological order.
   *
   * @param type - The audit event type to filter by.
   * @returns Array of matching events.
   */
  getEventsByType(type: AuditEventType): readonly AuditEvent[] {
    const indices = this.typeIndex.get(type);
    if (!indices) return [];
    return indices.map((i) => this.events[i]!);
  }

  /**
   * Verify the integrity of the underlying hash chain.
   *
   * Should be called periodically and before exporting evidence receipts
   * to detect any in-memory tampering.
   *
   * @returns `true` if the chain is intact.
   */
  verifyIntegrity(): boolean {
    const valid = this.chain.verify();
    if (!valid) {
      logger.error('Hash chain integrity check FAILED — possible tampering detected');
    }
    return valid;
  }

  /**
   * Return all recorded events (shallow copy).
   */
  getAllEvents(): readonly AuditEvent[] {
    return [...this.events];
  }

  /**
   * Return the current head hash of the underlying chain.
   */
  getChainHead(): string {
    return this.chain.getLatestHash();
  }

  /**
   * Return total number of recorded events.
   */
  get size(): number {
    return this.events.length;
  }
}
