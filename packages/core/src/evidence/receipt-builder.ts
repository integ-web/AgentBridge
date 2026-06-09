import type {
  AuditEvent,
  Approval,
  CapabilityGrant,
  EgressSummary,
  EvidenceReceipt,
  Task,
} from '../types.js';
import { AuditEventType, SitePolicyState } from '../types.js';
import { hashObject } from '../utils/index.js';
import { Redactor } from './redactor.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Derive a list of unique origins that received data egress from audit events.
 */
function extractEgressDestinations(events: readonly AuditEvent[]): string[] {
  const destinations = new Set<string>();
  for (const event of events) {
    if (event.type === AuditEventType.DataEgress) {
      const dest = event.redacted_payload['destination'];
      if (typeof dest === 'string') {
        destinations.add(dest);
      }
    }
  }
  return [...destinations];
}

/**
 * Derive the set of data classes that left the device.
 */
function extractEgressDataClasses(events: readonly AuditEvent[]): string[] {
  const classes = new Set<string>();
  for (const event of events) {
    if (event.type === AuditEventType.DataEgress) {
      const dc = event.redacted_payload['data_class'];
      if (typeof dc === 'string') {
        classes.add(dc);
      }
    }
  }
  return [...classes];
}

/**
 * Collect download hash records from file-download events.
 */
function extractDownloadHashes(
  events: readonly AuditEvent[],
): Array<{ filename: string; hash: string; size: number }> {
  const hashes: Array<{ filename: string; hash: string; size: number }> = [];
  for (const event of events) {
    if (event.type === AuditEventType.FileDownloaded) {
      const p = event.redacted_payload;
      const filename = typeof p['filename'] === 'string' ? p['filename'] : 'unknown';
      const hash = typeof p['hash'] === 'string' ? p['hash'] : '';
      const size = typeof p['size'] === 'number' ? p['size'] : 0;
      hashes.push({ filename, hash, size });
    }
  }
  return hashes;
}

/**
 * Build a redaction summary from redaction events.
 */
function buildRedactionSummary(
  events: readonly AuditEvent[],
): { count: number; categories: string[] } {
  const categories = new Set<string>();
  let count = 0;

  for (const event of events) {
    if (event.type === AuditEventType.RedactionApplied) {
      count++;
      const reason = event.redacted_payload['reason'];
      if (typeof reason === 'string') {
        categories.add(reason);
      }
    }
  }

  return { count, categories: [...categories] };
}

/**
 * Derive unique site policies from the task origins and grant origins.
 */
function deriveSitePolicies(
  task: Task,
  grants: readonly CapabilityGrant[],
): Array<{ origin: string; state: SitePolicyState }> {
  const originSet = new Set<string>(task.origins);
  for (const grant of grants) {
    originSet.add(grant.origin);
  }
  return [...originSet].map((origin) => ({
    origin,
    state: SitePolicyState.Unknown,
  }));
}

// ─── ReceiptBuilder ──────────────────────────────────────────────────────────

/**
 * Assembles a complete {@link EvidenceReceipt} from task metadata,
 * capability grants, audit events, and approval records.
 *
 * The receipt includes:
 * - Task mode, status, and timeline
 * - All capability grants and site policy snapshots
 * - Full audit event log
 * - Approval decisions
 * - Egress summary (what data left the device)
 * - Redaction summary (how many fields were redacted and why)
 * - Download hashes (integrity proof for downloaded files)
 * - An overall integrity hash covering the entire receipt
 *
 * @example
 * ```ts
 * const builder = new ReceiptBuilder();
 * const receipt = builder.buildReceipt(task, grants, events, approvals);
 * const json = builder.exportJSON(receipt);
 * ```
 */
export class ReceiptBuilder {
  /** Redactor for external-share exports. */
  private readonly redactor: Redactor;

  constructor(redactor?: Redactor) {
    this.redactor = redactor ?? new Redactor();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Build a complete evidence receipt.
   *
   * @param task      - The task this receipt covers.
   * @param grants    - All capability grants issued for the task.
   * @param events    - All audit events recorded during the task.
   * @param approvals - All approval decisions made during the task.
   * @returns A fully populated {@link EvidenceReceipt}.
   */
  buildReceipt(
    task: Task,
    grants: readonly CapabilityGrant[],
    events: readonly AuditEvent[],
    approvals: readonly Approval[],
  ): EvidenceReceipt {
    const destinations = extractEgressDestinations(events);
    const dataClasses = extractEgressDataClasses(events);

    const egressSummary: EgressSummary = {
      data_left_device: destinations.length > 0,
      destinations,
      data_classes: dataClasses,
      redaction_applied: events.some(
        (e) => e.type === AuditEventType.RedactionApplied,
      ),
    };

    const redactionSummary = buildRedactionSummary(events);
    const downloadHashes = extractDownloadHashes(events);
    const sitePolicies = deriveSitePolicies(task, grants);

    // Build the receipt without the integrity hash first.
    const receiptWithoutHash: Omit<EvidenceReceipt, 'integrity_hash'> = {
      task_id: task.id,
      objective: task.objective,
      mode: task.mode,
      status: task.status,
      created_at: task.created_at,
      completed_at: task.completed_at,
      grants: [...grants],
      site_policies: sitePolicies,
      events: [...events],
      approvals: [...approvals],
      egress_summary: egressSummary,
      redaction_summary: redactionSummary,
      download_hashes: downloadHashes,
    };

    // Compute integrity hash over the entire content.
    const integrityHash = hashObject(
      receiptWithoutHash as unknown as Record<string, unknown>,
    );

    return {
      ...receiptWithoutHash,
      integrity_hash: integrityHash,
    };
  }

  /**
   * Export the receipt as a pretty-printed JSON string.
   *
   * @param receipt - A complete evidence receipt.
   * @returns JSON string with 2-space indentation.
   */
  exportJSON(receipt: EvidenceReceipt): string {
    return JSON.stringify(receipt, null, 2);
  }

  /**
   * Export the receipt with additional redaction applied — suitable for
   * sharing externally (e.g. with third-party auditors) where internal
   * event payloads should be further sanitised.
   *
   * Specifically, this:
   * - Re-redacts every event's `redacted_payload` with the full Redactor.
   * - Re-redacts approval diffs.
   * - Recomputes the integrity hash over the redacted content.
   *
   * @param receipt - A complete evidence receipt.
   * @returns A new receipt with deeper redaction and updated integrity hash.
   */
  exportRedacted(receipt: EvidenceReceipt): EvidenceReceipt {
    const redactedEvents = receipt.events.map((event) => ({
      ...event,
      redacted_payload: this.redactor.redactObject(event.redacted_payload),
    }));

    const redactedApprovals = receipt.approvals.map((approval) => ({
      ...approval,
      diff: {
        ...approval.diff,
        data: this.redactor.redactObject(
          approval.diff.data as Record<string, unknown>,
        ),
        summary: this.redactor.redactString(approval.diff.summary),
        consequence: this.redactor.redactString(approval.diff.consequence),
        agent_reason: this.redactor.redactString(approval.diff.agent_reason),
      },
      action: {
        ...approval.action,
        value: approval.action.value
          ? this.redactor.redactString(approval.action.value)
          : undefined,
        metadata: approval.action.metadata
          ? this.redactor.redactObject(
              approval.action.metadata as Record<string, unknown>,
            )
          : undefined,
      },
    }));

    const redactedGrants = receipt.grants.map((grant) => ({
      ...grant,
      // data_class may contain sensitive info
      data_class: grant.data_class
        ? this.redactor.redactString(grant.data_class)
        : undefined,
    }));

    const baseReceipt: Omit<EvidenceReceipt, 'integrity_hash'> = {
      task_id: receipt.task_id,
      objective: this.redactor.redactString(receipt.objective),
      mode: receipt.mode,
      status: receipt.status,
      created_at: receipt.created_at,
      completed_at: receipt.completed_at,
      grants: redactedGrants,
      site_policies: receipt.site_policies,
      events: redactedEvents,
      approvals: redactedApprovals,
      egress_summary: receipt.egress_summary,
      redaction_summary: receipt.redaction_summary,
      download_hashes: receipt.download_hashes,
    };

    const integrityHash = hashObject(
      baseReceipt as unknown as Record<string, unknown>,
    );

    return { ...baseReceipt, integrity_hash: integrityHash };
  }
}
