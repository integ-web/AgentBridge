import type { SitePolicy, TrafficBudgetConfig } from '../types.js';
import { SitePolicyState, CapabilityType } from '../types.js';
import { createLogger } from '../utils/index.js';

const logger = createLogger('SitePolicyRegistry');

// ─── Defaults ────────────────────────────────────────────────────────────────

/** Conservative traffic budget applied to unknown origins. */
function defaultUnknownBudget(origin: string): TrafficBudgetConfig {
  return {
    origin,
    max_concurrent_tasks: 1,
    requests_per_minute: 10,
    max_retries: 3,
    backoff_base_ms: 1_000,
    backoff_max_ms: 30_000,
    max_downloads_per_task: 5,
    max_download_size_mb: 50,
    max_scroll_depth: 5_000,
    max_tabs: 1,
  };
}

/** Generous budget for developer/test origins. */
function defaultDevBudget(origin: string): TrafficBudgetConfig {
  return {
    origin,
    max_concurrent_tasks: 5,
    requests_per_minute: 120,
    max_retries: 10,
    backoff_base_ms: 200,
    backoff_max_ms: 5_000,
    max_downloads_per_task: 100,
    max_download_size_mb: 500,
    max_scroll_depth: 50_000,
    max_tabs: 10,
  };
}

/** Moderate budget for approved browser-delegated origins. */
function defaultApprovedBudget(origin: string): TrafficBudgetConfig {
  return {
    origin,
    max_concurrent_tasks: 3,
    requests_per_minute: 60,
    max_retries: 5,
    backoff_base_ms: 500,
    backoff_max_ms: 15_000,
    max_downloads_per_task: 20,
    max_download_size_mb: 200,
    max_scroll_depth: 20_000,
    max_tabs: 5,
  };
}

/** Build an unknown/conservative SitePolicy for an unrecognised origin. */
function buildUnknownPolicy(origin: string): SitePolicy {
  return {
    origin,
    state: SitePolicyState.Unknown,
    traffic_budget: defaultUnknownBudget(origin),
    legal_status: 'unreviewed',
    prohibited_actions: [],
    allowed_capabilities: [
      CapabilityType.NavigateOrigin,
      CapabilityType.ReadVisibleText,
      CapabilityType.ReadScreenshot,
    ],
  };
}

// ─── Pre-loaded entries ──────────────────────────────────────────────────────

function buildPreloadedPolicies(): Map<string, SitePolicy> {
  const map = new Map<string, SitePolicy>();

  // localhost variants
  const localhostOrigins = [
    'http://localhost',
    'https://localhost',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8080',
    'http://127.0.0.1',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:8080',
  ];

  for (const origin of localhostOrigins) {
    map.set(origin, {
      origin,
      state: SitePolicyState.ApprovedBrowserDelegated,
      traffic_budget: defaultDevBudget(origin),
      legal_status: 'reviewed',
      robots_notes: 'Local development — no restrictions.',
    });
  }

  return map;
}

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * In-memory registry of per-origin site policies.
 *
 * Provides conservative defaults for unknown origins and ships with
 * pre-loaded entries for common developer domains (localhost, etc.).
 */
export class SitePolicyRegistry {
  private readonly policies: Map<string, SitePolicy>;

  constructor() {
    this.policies = buildPreloadedPolicies();
    logger.debug('SitePolicyRegistry initialised', {
      preloaded: String(this.policies.size),
    });
  }

  /**
   * Retrieve the policy for the given origin.
   * If no policy exists a conservative "Unknown" default is created and stored.
   *
   * @param origin - The origin to look up (e.g. `https://example.com`).
   * @returns The {@link SitePolicy} for the origin.
   */
  get(origin: string): SitePolicy {
    const normalised = this.normalise(origin);
    let policy = this.policies.get(normalised);
    if (!policy) {
      policy = buildUnknownPolicy(normalised);
      this.policies.set(normalised, policy);
      logger.info('Created default Unknown policy', { origin: normalised });
    }
    return policy;
  }

  /**
   * Insert or update a policy for the given origin.
   *
   * @param origin - The origin to set.
   * @param policy - The full {@link SitePolicy} object.
   */
  set(origin: string, policy: SitePolicy): void {
    const normalised = this.normalise(origin);
    this.policies.set(normalised, { ...policy, origin: normalised });
    logger.info('Policy updated', { origin: normalised, state: policy.state });
  }

  /**
   * Get the {@link SitePolicyState} for an origin.
   *
   * @param origin - The origin to look up.
   * @returns The current policy state.
   */
  getState(origin: string): SitePolicyState {
    return this.get(origin).state;
  }

  /**
   * Get the default {@link TrafficBudgetConfig} for an origin,
   * based on its policy state.
   *
   * @param origin - The origin to look up.
   * @returns A traffic budget configuration.
   */
  getDefaultBudget(origin: string): TrafficBudgetConfig {
    const policy = this.get(origin);

    switch (policy.state) {
      case SitePolicyState.ApprovedApiFirst:
      case SitePolicyState.ApprovedBrowserDelegated:
        return defaultApprovedBudget(origin);

      case SitePolicyState.ReadOnly:
      case SitePolicyState.HumanOnlyChallenge:
      case SitePolicyState.PartnerRequired:
      case SitePolicyState.Unknown:
        return defaultUnknownBudget(origin);

      case SitePolicyState.RestrictedBanned:
        // Banned origins get the most restrictive budget
        return {
          ...defaultUnknownBudget(origin),
          requests_per_minute: 0,
          max_concurrent_tasks: 0,
          max_retries: 0,
        };

      default:
        return defaultUnknownBudget(origin);
    }
  }

  /**
   * Check whether a pre-loaded or user-set policy exists for the origin.
   *
   * @param origin - The origin to check.
   * @returns `true` if a policy is already registered.
   */
  has(origin: string): boolean {
    return this.policies.has(this.normalise(origin));
  }

  /**
   * Return all registered origins with their states (useful for debugging).
   */
  listAll(): Array<{ origin: string; state: SitePolicyState }> {
    return Array.from(this.policies.entries()).map(([origin, p]) => ({
      origin,
      state: p.state,
    }));
  }

  /** Normalise an origin to lower-case, strip trailing slashes. */
  private normalise(origin: string): string {
    return origin.toLowerCase().replace(/\/+$/, '');
  }
}
