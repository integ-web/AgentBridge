import type { ActionRequest, CapabilityGrant } from '../types.js';
import { ActionType, CapabilityType } from '../types.js';
import { isExpired, createLogger } from '../utils/index.js';

/**
 * Result of a capability check.
 * Contains the decision, a human-readable reason, and the matching grant (if any).
 */
export interface CapabilityCheckResult {
  /** Whether the capability is granted for the requested action. */
  granted: boolean;
  /** Human-readable explanation of the decision. */
  reason: string;
  /** The matching grant, if one was found. */
  grant?: CapabilityGrant;
}

/**
 * Mapping from ActionType to the minimum CapabilityType required.
 * Some actions may require one of several capabilities; this map
 * captures the primary mapping used for grant lookup.
 */
const ACTION_TO_CAPABILITY: ReadonlyMap<ActionType, CapabilityType[]> = new Map([
  [ActionType.Navigate, [CapabilityType.NavigateOrigin]],
  [ActionType.Click, [CapabilityType.ActionClickLow]],
  [ActionType.Fill, [CapabilityType.ActionFill]],
  [ActionType.Submit, [CapabilityType.ActionSubmit]],
  [ActionType.Scroll, [CapabilityType.NavigateOrigin]], // scroll requires at least navigate
  [ActionType.Download, [CapabilityType.FileDownload]],
  [ActionType.Upload, [CapabilityType.FileUpload]],
  [ActionType.Select, [CapabilityType.ActionClickLow]],
  [ActionType.Screenshot, [CapabilityType.ReadScreenshot]],
  [ActionType.HumanTakeover, [CapabilityType.SessionReuse]],
]);

/**
 * Checks whether a {@link CapabilityGrant} covers a requested action.
 *
 * The checker evaluates grants against the following criteria:
 * 1. **Capability type** — the grant's capability must match the action's required capability
 * 2. **Origin matching** — the grant's origin must match the action's origin (supports wildcards)
 * 3. **Task scope** — the grant must belong to the same task
 * 4. **Expiry** — the grant must not be expired
 * 5. **Revocation** — the grant must not be revoked
 *
 * @example
 * ```ts
 * const checker = new CapabilityChecker();
 * const result = checker.check(action, grants);
 * if (!result.granted) {
 *   console.log(`Denied: ${result.reason}`);
 * }
 * ```
 */
export class CapabilityChecker {
  private readonly logger = createLogger('CapabilityChecker');

  /**
   * Check if any of the provided grants cover the requested action.
   *
   * @param action - The action request to check.
   * @param grants - The list of active capability grants for the task.
   * @returns A {@link CapabilityCheckResult} indicating grant status.
   */
  check(action: ActionRequest, grants: CapabilityGrant[]): CapabilityCheckResult {
    // Determine required capabilities for this action type
    const requiredCapabilities = ACTION_TO_CAPABILITY.get(action.type);
    if (!requiredCapabilities || requiredCapabilities.length === 0) {
      this.logger.warn('No capability mapping for action type', {
        action_type: action.type,
      });
      return {
        granted: false,
        reason: `No capability mapping defined for action type '${action.type}'`,
      };
    }

    // Extract origin from the action's URL
    const actionOrigin = this.extractOrigin(action.url);

    // Search for a matching grant
    for (const grant of grants) {
      // Must match the correct task
      if (grant.task_id !== action.task_id) {
        continue;
      }

      // Must be one of the required capabilities
      if (!requiredCapabilities.includes(grant.capability)) {
        continue;
      }

      // Must not be revoked
      if (grant.revoked_at) {
        this.logger.debug('Grant revoked, skipping', {
          grant_id: grant.id,
          revoked_at: grant.revoked_at,
        });
        continue;
      }

      // Must not be expired
      if (grant.expires_at && isExpired(grant.expires_at)) {
        this.logger.debug('Grant expired, skipping', {
          grant_id: grant.id,
          expires_at: grant.expires_at,
        });
        continue;
      }

      // Must match origin
      if (actionOrigin && !this.matchesOrigin(grant.origin, actionOrigin)) {
        continue;
      }

      this.logger.debug('Capability granted', {
        grant_id: grant.id,
        capability: grant.capability,
        origin: grant.origin,
      });

      return {
        granted: true,
        reason: `Granted by capability '${grant.capability}' for origin '${grant.origin}'`,
        grant,
      };
    }

    // No matching grant found
    const requiredStr = requiredCapabilities.join(' | ');
    const reason = actionOrigin
      ? `No valid grant found for capability [${requiredStr}] on origin '${actionOrigin}' in task '${action.task_id}'`
      : `No valid grant found for capability [${requiredStr}] in task '${action.task_id}'`;

    this.logger.debug('Capability denied', {
      action_id: action.id,
      action_type: action.type,
      required: requiredStr,
      origin: actionOrigin ?? 'unknown',
    });

    return { granted: false, reason };
  }

  /**
   * Check a specific capability type + origin against the grants list.
   * Useful for pre-flight checks before building an ActionRequest.
   *
   * @param capability - The capability type to check.
   * @param origin - The origin to check against.
   * @param taskId - The task ID scope.
   * @param grants - The available grants.
   * @returns A {@link CapabilityCheckResult} for the specific capability.
   */
  checkCapability(
    capability: CapabilityType,
    origin: string,
    taskId: string,
    grants: CapabilityGrant[],
  ): CapabilityCheckResult {
    for (const grant of grants) {
      if (grant.task_id !== taskId) continue;
      if (grant.capability !== capability) continue;
      if (grant.revoked_at) continue;
      if (grant.expires_at && isExpired(grant.expires_at)) continue;
      if (!this.matchesOrigin(grant.origin, origin)) continue;

      return {
        granted: true,
        reason: `Granted by grant '${grant.id}'`,
        grant,
      };
    }

    return {
      granted: false,
      reason: `No valid grant for capability '${capability}' on origin '${origin}'`,
    };
  }

  /**
   * Find all valid (non-expired, non-revoked) grants for a task.
   *
   * @param taskId - The task ID to filter by.
   * @param grants - The full grants list.
   * @returns Filtered list of active grants.
   */
  getActiveGrants(taskId: string, grants: CapabilityGrant[]): CapabilityGrant[] {
    return grants.filter((grant) => {
      if (grant.task_id !== taskId) return false;
      if (grant.revoked_at) return false;
      if (grant.expires_at && isExpired(grant.expires_at)) return false;
      return true;
    });
  }

  /**
   * Match an action origin against a grant origin pattern.
   * Supports:
   * - Exact match: `https://example.com`
   * - Wildcard subdomain: `*.example.com` matches `sub.example.com`, `a.b.example.com`
   * - Full wildcard: `*` matches any origin
   *
   * @param grantOrigin - The grant's origin pattern.
   * @param actionOrigin - The action's concrete origin.
   * @returns True if the action origin is covered by the grant pattern.
   */
  matchesOrigin(grantOrigin: string, actionOrigin: string): boolean {
    // Full wildcard
    if (grantOrigin === '*') {
      return true;
    }

    const normalizedGrant = grantOrigin.toLowerCase();
    const normalizedAction = actionOrigin.toLowerCase();

    // Exact match
    if (normalizedGrant === normalizedAction) {
      return true;
    }

    // Wildcard subdomain: *.example.com
    if (normalizedGrant.startsWith('*.')) {
      const baseDomain = normalizedGrant.slice(2); // "example.com"
      // The action origin must end with ".example.com" or be exactly "example.com"
      // For URL origins like "https://sub.example.com", we match against the hostname
      const actionHostname = this.extractHostname(normalizedAction);
      return (
        actionHostname === baseDomain ||
        actionHostname.endsWith('.' + baseDomain)
      );
    }

    // Protocol-aware comparison: compare hostnames if grant has no protocol
    const grantHostname = this.extractHostname(normalizedGrant);
    const actionHostname = this.extractHostname(normalizedAction);
    if (grantHostname && actionHostname && grantHostname === actionHostname) {
      return true;
    }

    return false;
  }

  /**
   * Extract the origin (protocol + hostname + port) from a URL.
   * Returns undefined for non-URL strings.
   */
  private extractOrigin(url: string | undefined): string | undefined {
    if (!url) return undefined;
    try {
      const parsed = new URL(url);
      return parsed.origin;
    } catch {
      // If it looks like a bare hostname/origin, return as-is
      return url;
    }
  }

  /**
   * Extract hostname from a URL or origin string.
   */
  private extractHostname(urlOrOrigin: string): string {
    try {
      const parsed = new URL(urlOrOrigin);
      return parsed.hostname;
    } catch {
      // If not a valid URL, strip any protocol prefix and return
      return urlOrOrigin.replace(/^https?:\/\//, '').split('/')[0]!.split(':')[0]!;
    }
  }
}
