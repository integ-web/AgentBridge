import type { Task, SitePolicy, RouteResolution, TrafficBudgetConfig } from '../types.js';
import {
  SitePolicyState,
  ExecutionRoute,
  TaskAccessPattern,
} from '../types.js';
import type { BudgetCheckResult } from './traffic-budget.js';
import { TrafficBudget } from './traffic-budget.js';
import { createLogger } from '../utils/index.js';

const logger = createLogger('RouteResolver');

/**
 * Determines the execution route for a task given the site policy and
 * current traffic budget state.
 *
 * Resolution priority:
 * 1. Official API (when available and policy is `ApprovedApiFirst`)
 * 2. Browser attach (local attach for delegated browser tasks)
 * 3. Bundled browser (hardened sandbox)
 * 4. Human-only (challenge or restricted interaction)
 * 5. Block (banned / prohibited)
 */
export class RouteResolver {
  /**
   * Resolve the best execution route.
   *
   * @param task          - The task to route.
   * @param sitePolicy    - The policy for the task's primary origin.
   * @param trafficBudget - The live traffic budget tracker.
   * @returns A {@link RouteResolution} describing the chosen route and context.
   */
  resolve(
    task: Task,
    sitePolicy: SitePolicy,
    trafficBudget: TrafficBudget,
  ): RouteResolution {
    const warnings: string[] = [];
    const primaryOrigin = task.origins[0] ?? 'unknown';

    // ── 1. Blocked / Banned ──────────────────────────────────────────────
    if (sitePolicy.state === SitePolicyState.RestrictedBanned) {
      logger.warn('Route blocked — site is restricted/banned', {
        origin: sitePolicy.origin,
      });
      return {
        route: ExecutionRoute.Block,
        reason: `Site '${sitePolicy.origin}' is restricted/banned. Task cannot proceed.`,
        site_policy_state: sitePolicy.state,
        traffic_budget: sitePolicy.traffic_budget,
        warnings: ['Origin is in the restricted/banned list.'],
      };
    }

    // ── 2. Human-only challenge ──────────────────────────────────────────
    if (sitePolicy.state === SitePolicyState.HumanOnlyChallenge) {
      logger.info('Route → human-only (challenge on site)', {
        origin: sitePolicy.origin,
      });
      return {
        route: ExecutionRoute.HumanOnly,
        reason: 'Site requires human verification. Agent will hand off.',
        site_policy_state: sitePolicy.state,
        traffic_budget: sitePolicy.traffic_budget,
        warnings: ['Human challenge detected — agent cannot proceed autonomously.'],
      };
    }

    // ── 3. Partner required ──────────────────────────────────────────────
    if (sitePolicy.state === SitePolicyState.PartnerRequired) {
      logger.info('Route → block (partner integration required)', {
        origin: sitePolicy.origin,
      });
      return {
        route: ExecutionRoute.Block,
        reason: `Site '${sitePolicy.origin}' requires a partner/API integration that is not configured.`,
        site_policy_state: sitePolicy.state,
        traffic_budget: sitePolicy.traffic_budget,
        warnings: ['Partner integration required but not available.'],
      };
    }

    // ── 4. API-first route ───────────────────────────────────────────────
    if (
      sitePolicy.state === SitePolicyState.ApprovedApiFirst &&
      sitePolicy.api_routes &&
      sitePolicy.api_routes.length > 0
    ) {
      const apiRoute = sitePolicy.api_routes[0];
      logger.info('Route → official API', {
        origin: sitePolicy.origin,
        endpoint: apiRoute.endpoint,
      });
      return {
        route: ExecutionRoute.OfficialApi,
        reason: `Official API available for '${sitePolicy.origin}'. Using endpoint '${apiRoute.name}'.`,
        api_route: apiRoute,
        site_policy_state: sitePolicy.state,
        traffic_budget: sitePolicy.traffic_budget,
        warnings,
      };
    }

    // ── 5. Traffic budget check ──────────────────────────────────────────
    const budgetResult: BudgetCheckResult = trafficBudget.checkBudget(primaryOrigin);
    if (!budgetResult.allowed) {
      warnings.push(`Traffic budget exceeded: ${budgetResult.reason}`);
      // Don't fully block — route to human-only so the user can decide
      logger.warn('Budget exceeded, routing to human-only', {
        origin: primaryOrigin,
        reason: budgetResult.reason,
      });
      return {
        route: ExecutionRoute.HumanOnly,
        reason: budgetResult.reason,
        site_policy_state: sitePolicy.state,
        traffic_budget: sitePolicy.traffic_budget,
        warnings,
      };
    }

    // ── 6. Approved browser-delegated ────────────────────────────────────
    if (sitePolicy.state === SitePolicyState.ApprovedBrowserDelegated) {
      const route = this.pickBrowserRoute(task);
      logger.info('Route → browser', {
        origin: sitePolicy.origin,
        route,
      });
      return {
        route,
        reason: `Browser-delegated access approved for '${sitePolicy.origin}'.`,
        site_policy_state: sitePolicy.state,
        traffic_budget: sitePolicy.traffic_budget,
        warnings,
      };
    }

    // ── 7. Read-only ─────────────────────────────────────────────────────
    if (sitePolicy.state === SitePolicyState.ReadOnly) {
      // Allow read-only browser access if the task pattern is safe
      if (
        task.access_pattern === TaskAccessPattern.CrawlLike ||
        task.access_pattern === TaskAccessPattern.Bulk
      ) {
        warnings.push(
          'Site is read-only but task pattern is crawl/bulk — restricted to low-rate reading.',
        );
      }
      return {
        route: ExecutionRoute.BundledBrowser,
        reason: `Read-only access for '${sitePolicy.origin}'. No mutations allowed.`,
        site_policy_state: sitePolicy.state,
        traffic_budget: sitePolicy.traffic_budget,
        warnings,
      };
    }

    // ── 8. Unknown origin — conservative defaults ────────────────────────
    if (sitePolicy.state === SitePolicyState.Unknown) {
      this.addUnknownWarnings(task, warnings);
      const conservativeBudget: TrafficBudgetConfig = {
        ...sitePolicy.traffic_budget,
        requests_per_minute: Math.min(sitePolicy.traffic_budget.requests_per_minute, 10),
        max_concurrent_tasks: 1,
      };

      return {
        route: ExecutionRoute.BundledBrowser,
        reason: `Unknown origin '${sitePolicy.origin}'. Applying conservative defaults (read-only, low rate).`,
        site_policy_state: sitePolicy.state,
        traffic_budget: conservativeBudget,
        warnings,
      };
    }

    // ── 9. Fallback ──────────────────────────────────────────────────────
    return {
      route: ExecutionRoute.Block,
      reason: `No resolution strategy for policy state '${sitePolicy.state}' on '${sitePolicy.origin}'.`,
      site_policy_state: sitePolicy.state,
      traffic_budget: sitePolicy.traffic_budget,
      warnings: ['Unhandled policy state — blocking as a safety measure.'],
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /**
   * Choose between LocalAttach, BundledBrowser, or RemoteRunner
   * depending on the task's access pattern and mode.
   */
  private pickBrowserRoute(task: Task): ExecutionRoute {
    if (task.access_pattern === TaskAccessPattern.DeveloperTest) {
      return ExecutionRoute.LocalAttach;
    }
    if (
      task.access_pattern === TaskAccessPattern.Bulk ||
      task.access_pattern === TaskAccessPattern.CrawlLike
    ) {
      return ExecutionRoute.RemoteRunner;
    }
    // Default for user-delegated, transactional, etc.
    return ExecutionRoute.LocalAttach;
  }

  /** Append warnings for tasks touching an unknown origin. */
  private addUnknownWarnings(task: Task, warnings: string[]): void {
    warnings.push(
      'Origin has no known policy — conservative read-only defaults apply.',
    );
    if (task.access_pattern === TaskAccessPattern.Transactional) {
      warnings.push(
        'Transactional tasks on unknown origins are high-risk. Consider reviewing the site policy.',
      );
    }
    if (task.access_pattern === TaskAccessPattern.Regulated) {
      warnings.push(
        'Regulated-domain tasks on unknown origins require explicit review.',
      );
    }
  }
}
