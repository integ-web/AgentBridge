import type {
  Task,
  ActionRequest,
  RouteResolution,
  SitePolicy,
} from '../types.js';
import {
  ExecutionRoute,
  SitePolicyState,
  RiskLevel,
  ActionType,
  SiteBlockedError,
  TrafficBudgetExceededError,
  ChallengeDetectedError,
  ProhibitedActionError,
} from '../types.js';
import { TaskClassifier } from './task-classifier.js';
import type { ClassificationContext } from './task-classifier.js';
import { SitePolicyRegistry } from './site-policy-registry.js';
import { TrafficBudget } from './traffic-budget.js';
import { ChallengeDetector } from './challenge-detector.js';
import type { PageSignals } from './challenge-detector.js';
import { RouteResolver } from './route-resolver.js';
import { createLogger } from '../utils/index.js';

const logger = createLogger('RestrictionComplianceLayer');

// ─── Local types ─────────────────────────────────────────────────────────────

/** Result of checking a single action's compliance. */
export interface ActionComplianceResult {
  /** Whether the action is allowed. */
  allowed: boolean;
  /** Human-readable reason. */
  reason: string;
  /** The risk level assigned to this action. */
  risk: RiskLevel;
  /** Whether approval from a human is required before executing. */
  requiresApproval: boolean;
}

/** Context that accompanies an action compliance check. */
export interface ActionTaskContext {
  /** The task this action belongs to. */
  task: Task;
  /** Current page signals (optional — used for challenge detection). */
  pageSignals?: PageSignals;
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

/**
 * The Restriction Compliance Layer (RCL) is the central policy
 * enforcement point for AgentBridge.
 *
 * It orchestrates:
 * - {@link TaskClassifier} — access-pattern classification
 * - {@link SitePolicyRegistry} — per-origin policy lookup
 * - {@link TrafficBudget} — rate / concurrency enforcement
 * - {@link ChallengeDetector} — CAPTCHA / MFA detection
 * - {@link RouteResolver} — execution route selection
 *
 * All task evaluations and action checks flow through this class.
 */
export class RestrictionComplianceLayer {
  private readonly classifier: TaskClassifier;
  private readonly registry: SitePolicyRegistry;
  private readonly budget: TrafficBudget;
  private readonly challengeDetector: ChallengeDetector;
  private readonly routeResolver: RouteResolver;

  constructor(options?: {
    registry?: SitePolicyRegistry;
    budget?: TrafficBudget;
  }) {
    this.classifier = new TaskClassifier();
    this.registry = options?.registry ?? new SitePolicyRegistry();
    this.budget = options?.budget ?? new TrafficBudget();
    this.challengeDetector = new ChallengeDetector();
    this.routeResolver = new RouteResolver();
  }

  // ── Accessors ──────────────────────────────────────────────────────────

  /** Expose the underlying site-policy registry for direct management. */
  get siteRegistry(): SitePolicyRegistry {
    return this.registry;
  }

  /** Expose the underlying traffic budget tracker. */
  get trafficBudget(): TrafficBudget {
    return this.budget;
  }

  // ── Task evaluation ────────────────────────────────────────────────────

  /**
   * Evaluate a task end-to-end: classify its pattern, look up site
   * policies for every origin, ensure traffic budgets are registered,
   * and resolve the execution route.
   *
   * @param task    - The task to evaluate.
   * @param context - Optional classification context.
   * @returns A {@link RouteResolution} for the task.
   * @throws {SiteBlockedError} if the primary origin is banned.
   * @throws {TrafficBudgetExceededError} if traffic limits are exhausted.
   */
  evaluateTask(
    task: Task,
    context?: ClassificationContext,
  ): RouteResolution {
    logger.info('Evaluating task', {
      taskId: task.id,
      objective: task.objective.slice(0, 80),
    });

    // 1. Classify the access pattern
    const classification = this.classifier.classify(
      task.objective,
      task.origins,
      context,
    );

    logger.debug('Classification result', {
      pattern: classification.pattern,
      confidence: String(classification.confidence),
    });

    // Stamp the classification back onto the task (mutates)
    (task as { access_pattern: typeof classification.pattern }).access_pattern =
      classification.pattern;

    // 2. Look up site policies and register budgets for every origin
    const primaryOrigin = task.origins[0] ?? 'unknown';
    const primaryPolicy: SitePolicy = this.registry.get(primaryOrigin);

    for (const origin of task.origins) {
      const policy = this.registry.get(origin);
      if (!this.budget.getBudget(origin)) {
        this.budget.setBudget(policy.traffic_budget);
      }
    }

    // 3. Fail-fast: if primary origin is banned, throw
    if (primaryPolicy.state === SitePolicyState.RestrictedBanned) {
      throw new SiteBlockedError(
        primaryOrigin,
        primaryPolicy.state,
        `Task '${task.id}' targets a restricted/banned origin.`,
      );
    }

    // 4. Check the traffic budget for the primary origin
    const budgetCheck = this.budget.checkBudget(primaryOrigin);
    if (!budgetCheck.allowed) {
      throw new TrafficBudgetExceededError(
        primaryOrigin,
        budgetCheck.reason,
        this.registry.get(primaryOrigin).traffic_budget.requests_per_minute,
      );
    }

    // 5. Resolve the route
    const resolution = this.routeResolver.resolve(
      task,
      primaryPolicy,
      this.budget,
    );

    logger.info('Route resolved', {
      taskId: task.id,
      route: resolution.route,
      warnings: String(resolution.warnings.length),
    });

    return resolution;
  }

  // ── Action compliance ──────────────────────────────────────────────────

  /**
   * Check whether a specific action is compliant given the current
   * task context and page state.
   *
   * @param action  - The action request to check.
   * @param context - Task context and optional page signals.
   * @returns An {@link ActionComplianceResult}.
   * @throws {ChallengeDetectedError} if the page shows a human challenge.
   * @throws {ProhibitedActionError}  if the action is explicitly prohibited.
   */
  checkAction(
    action: ActionRequest,
    context: ActionTaskContext,
  ): ActionComplianceResult {
    const { task, pageSignals } = context;
    const origin = this.extractOrigin(action);

    // 1. Challenge detection (if page signals available)
    if (pageSignals) {
      const challenge = this.challengeDetector.detect(pageSignals);
      if (challenge.detected && challenge.type) {
        throw new ChallengeDetectedError(challenge.type, origin);
      }
    }

    // 2. Site policy check
    const policy = this.registry.get(origin);

    // Action on a banned site
    if (policy.state === SitePolicyState.RestrictedBanned) {
      throw new ProhibitedActionError(
        action.type,
        `Origin '${origin}' is restricted/banned.`,
      );
    }

    // Prohibited action list
    if (policy.prohibited_actions?.includes(action.type)) {
      throw new ProhibitedActionError(
        action.type,
        `Action '${action.type}' is explicitly prohibited for '${origin}'.`,
      );
    }

    // Read-only site — block mutating actions
    if (policy.state === SitePolicyState.ReadOnly) {
      if (this.isMutatingAction(action.type)) {
        return {
          allowed: false,
          reason: `Site '${origin}' is read-only. Mutating action '${action.type}' is not allowed.`,
          risk: RiskLevel.High,
          requiresApproval: false,
        };
      }
    }

    // 3. Traffic budget check
    const budgetCheck = this.budget.checkBudget(origin);
    if (!budgetCheck.allowed) {
      return {
        allowed: false,
        reason: budgetCheck.reason,
        risk: action.risk,
        requiresApproval: false,
      };
    }

    // 4. Risk-based approval requirement
    const requiresApproval =
      action.risk === RiskLevel.High ||
      action.risk === RiskLevel.Critical;

    // 5. Prohibited risk level
    if (action.risk === RiskLevel.Prohibited) {
      throw new ProhibitedActionError(
        action.type,
        'Action is classified as prohibited-risk and cannot be executed.',
      );
    }

    return {
      allowed: true,
      reason: 'Action is compliant.',
      risk: action.risk,
      requiresApproval,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  /** Extract an origin string from an action request. */
  private extractOrigin(action: ActionRequest): string {
    if (action.url) {
      try {
        const url = new URL(action.url);
        return url.origin;
      } catch {
        // fall through
      }
    }
    return 'unknown';
  }

  /** Determine whether an action type is mutating (writes data). */
  private isMutatingAction(type: ActionType): boolean {
    return [
      ActionType.Fill,
      ActionType.Submit,
      ActionType.Upload,
      ActionType.Select,
    ].includes(type);
  }
}
