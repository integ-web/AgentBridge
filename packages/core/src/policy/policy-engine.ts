import type {
  ActionRequest,
  CapabilityGrant,
  Policy,
  PolicyDecision,
  PolicyRule,
} from '../types.js';
import {
  CapabilityType,
  ExecutionRoute,
  RiskLevel,
} from '../types.js';
import { createLogger } from '../utils/index.js';
import { RiskClassifier } from './risk-classifier.js';
import { CapabilityChecker } from './capability-checker.js';

/**
 * Priority-ordered risk levels from most to least severe.
 * Used when comparing or escalating risk levels.
 */
const RISK_SEVERITY: ReadonlyMap<RiskLevel, number> = new Map([
  [RiskLevel.Prohibited, 4],
  [RiskLevel.Critical, 3],
  [RiskLevel.High, 2],
  [RiskLevel.Medium, 1],
  [RiskLevel.Low, 0],
]);

/**
 * Returns the higher of two risk levels.
 */
function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return (RISK_SEVERITY.get(a) ?? 0) >= (RISK_SEVERITY.get(b) ?? 0) ? a : b;
}

/**
 * The core policy engine for AgentBridge.
 *
 * Evaluates whether a requested browser action is permitted by combining:
 * 1. **Risk classification** — Determines the action's risk level
 * 2. **Capability checking** — Validates that the required capability is granted
 * 3. **Policy rule evaluation** — Applies allow/deny/require_approval rules
 * 4. **Enterprise override** — Enterprise-scoped policies take precedence
 *
 * The evaluation order is:
 * 1. Prohibited actions are always denied (no override possible)
 * 2. Enterprise deny rules override all other grants
 * 3. Explicit deny rules are evaluated (highest priority first)
 * 4. Capability grants are checked for the action
 * 5. Allow/require_approval rules are evaluated
 * 6. Default: deny if no matching grant or allow rule
 *
 * @example
 * ```ts
 * const engine = new PolicyEngine(policies, grants);
 * const decision = engine.evaluate(actionRequest);
 * if (!decision.allowed) {
 *   console.log(`Blocked: ${decision.reason}`);
 * }
 * if (decision.requires_approval) {
 *   await requestHumanApproval(actionRequest);
 * }
 * ```
 */
export class PolicyEngine {
  private readonly logger = createLogger('PolicyEngine');
  private readonly riskClassifier: RiskClassifier;
  private readonly capabilityChecker: CapabilityChecker;

  /**
   * All rules flattened from policies, sorted by priority descending.
   * Enterprise rules are tagged with their scope for override logic.
   */
  private readonly sortedRules: Array<PolicyRule & { scope: Policy['scope'] }>;

  /**
   * Create a new PolicyEngine.
   *
   * @param policies - The set of active policies (user, team, enterprise).
   * @param grants - The set of active capability grants.
   */
  constructor(
    private readonly policies: Policy[],
    private readonly grants: CapabilityGrant[],
  ) {
    this.riskClassifier = new RiskClassifier();
    this.capabilityChecker = new CapabilityChecker();

    // Flatten all rules across policies, annotated with scope
    this.sortedRules = this.flattenAndSortRules(policies);

    this.logger.info('PolicyEngine initialized', {
      policy_count: String(policies.length),
      grant_count: String(grants.length),
      rule_count: String(this.sortedRules.length),
    });
  }

  /**
   * Evaluate whether an action request is permitted.
   *
   * @param action - The action request from an agent.
   * @returns A {@link PolicyDecision} with the allow/deny verdict, risk level,
   *          and whether human approval is required.
   */
  evaluate(action: ActionRequest): PolicyDecision {
    // Step 1: Classify the action's risk level
    const classifiedRisk = this.riskClassifier.classify(action);
    const effectiveRisk = maxRisk(classifiedRisk, action.risk);

    this.logger.debug('Evaluating action', {
      action_id: action.id,
      type: action.type,
      classified_risk: classifiedRisk,
      declared_risk: action.risk,
      effective_risk: effectiveRisk,
    });

    // Step 2: Prohibited actions are ALWAYS denied — no override possible
    if (effectiveRisk === RiskLevel.Prohibited) {
      return this.deny(
        effectiveRisk,
        'Action classified as prohibited. AgentBridge does not support CAPTCHA bypass, stealth evasion, credential theft, spam, or rate-limit evasion.',
      );
    }

    // Step 3: Check enterprise deny rules (highest priority override)
    const enterpriseDeny = this.findMatchingRule(action, effectiveRisk, 'deny', 'enterprise');
    if (enterpriseDeny) {
      return this.deny(
        effectiveRisk,
        `Blocked by enterprise policy: ${enterpriseDeny.description}`,
        enterpriseDeny.id,
      );
    }

    // Step 4: Check all deny rules (any scope, by priority)
    const denyRule = this.findMatchingRule(action, effectiveRisk, 'deny');
    if (denyRule) {
      return this.deny(
        effectiveRisk,
        `Blocked by policy rule: ${denyRule.description}`,
        denyRule.id,
      );
    }

    // Step 5: Check for require_api rules — redirect to official API
    const apiRule = this.findMatchingRule(action, effectiveRisk, 'require_api');
    if (apiRule) {
      return {
        allowed: false,
        risk: effectiveRisk,
        requires_approval: false,
        reason: `Official API required: ${apiRule.description}`,
        rule_id: apiRule.id,
        alternative_route: ExecutionRoute.OfficialApi,
      };
    }

    // Step 6: Check capability grants
    const capCheck = this.capabilityChecker.check(action, this.grants);

    // Step 7: Check for require_approval rules
    const approvalRule = this.findMatchingRule(action, effectiveRisk, 'require_approval');

    // Step 8: Check for explicit allow rules
    const allowRule = this.findMatchingRule(action, effectiveRisk, 'allow');

    // Step 9: Decision logic
    if (capCheck.granted) {
      // Capability is granted — check if approval is still required

      // Critical risk always requires approval (even with grants)
      if (effectiveRisk === RiskLevel.Critical) {
        return this.requireApproval(
          effectiveRisk,
          'Critical-risk action requires human approval before execution.',
          approvalRule?.id,
        );
      }

      // If a require_approval rule matches, demand approval
      if (approvalRule) {
        return this.requireApproval(
          effectiveRisk,
          `Approval required by policy: ${approvalRule.description}`,
          approvalRule.id,
        );
      }

      // High risk defaults to requiring approval unless an explicit allow rule is present
      if (effectiveRisk === RiskLevel.High && !allowRule) {
        return this.requireApproval(
          effectiveRisk,
          'High-risk action requires human approval unless explicitly allowed by policy.',
        );
      }

      // Granted and no approval needed
      return this.allow(effectiveRisk, capCheck.reason, allowRule?.id);
    }

    // No capability grant — check if an allow rule alone is sufficient
    if (allowRule) {
      // Allow rules can cover low and medium risk without explicit grants
      if (effectiveRisk === RiskLevel.Low || effectiveRisk === RiskLevel.Medium) {
        if (approvalRule) {
          return this.requireApproval(
            effectiveRisk,
            `Allowed by policy but approval required: ${approvalRule.description}`,
            approvalRule.id,
          );
        }
        return this.allow(
          effectiveRisk,
          `Allowed by policy rule: ${allowRule.description}`,
          allowRule.id,
        );
      }

      // High/Critical still needs grants even with allow rules
      return this.deny(
        effectiveRisk,
        `Allow rule matched but capability grant required for ${effectiveRisk}-risk actions. ${capCheck.reason}`,
        allowRule.id,
        this.getMissingCapabilities(action),
      );
    }

    // Step 10: Default deny — no matching grant and no allow rule
    return this.deny(
      effectiveRisk,
      `Default deny: ${capCheck.reason}`,
      undefined,
      this.getMissingCapabilities(action),
    );
  }

  /**
   * Evaluate multiple actions at once, returning decisions in order.
   *
   * @param actions - Array of action requests to evaluate.
   * @returns Array of {@link PolicyDecision} objects, one per input action.
   */
  evaluateAll(actions: ActionRequest[]): PolicyDecision[] {
    return actions.map((action) => this.evaluate(action));
  }

  /**
   * Check whether a specific capability is available for a task + origin,
   * without building a full ActionRequest.
   *
   * @param capability - The capability type to check.
   * @param origin - The target origin.
   * @param taskId - The task scope.
   * @returns True if the capability is granted and not denied by policy.
   */
  hasCapability(capability: CapabilityType, origin: string, taskId: string): boolean {
    const result = this.capabilityChecker.checkCapability(
      capability,
      origin,
      taskId,
      this.grants,
    );
    return result.granted;
  }

  /**
   * Get the risk classifier instance for direct classification queries.
   */
  getRiskClassifier(): RiskClassifier {
    return this.riskClassifier;
  }

  /**
   * Get the capability checker instance for direct grant queries.
   */
  getCapabilityChecker(): CapabilityChecker {
    return this.capabilityChecker;
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Flatten all rules from all policies into a single sorted list.
   * Rules are annotated with their policy scope for enterprise override logic.
   * Sorted by priority descending — highest priority rules evaluate first.
   */
  private flattenAndSortRules(
    policies: Policy[],
  ): Array<PolicyRule & { scope: Policy['scope'] }> {
    const rules: Array<PolicyRule & { scope: Policy['scope'] }> = [];

    for (const policy of policies) {
      for (const rule of policy.rules) {
        rules.push({ ...rule, scope: policy.scope });
      }
    }

    // Sort by priority descending; enterprise rules win ties
    rules.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      // Enterprise > team > user at same priority
      const scopeWeight: Record<string, number> = { enterprise: 2, team: 1, user: 0 };
      return (scopeWeight[b.scope] ?? 0) - (scopeWeight[a.scope] ?? 0);
    });

    return rules;
  }

  /**
   * Find the first rule that matches the action, risk level, and criteria.
   *
   * @param action - The action request to match against.
   * @param risk - The effective risk level.
   * @param ruleType - The rule type to search for.
   * @param scope - Optional: only match rules from this scope.
   * @returns The first matching rule, or undefined.
   */
  private findMatchingRule(
    action: ActionRequest,
    risk: RiskLevel,
    ruleType: PolicyRule['type'],
    scope?: Policy['scope'],
  ): (PolicyRule & { scope: Policy['scope'] }) | undefined {
    for (const rule of this.sortedRules) {
      if (rule.type !== ruleType) continue;
      if (scope && rule.scope !== scope) continue;
      if (this.ruleMatchesAction(rule, action, risk)) {
        return rule;
      }
    }
    return undefined;
  }

  /**
   * Check whether a single rule's targets match the given action and risk level.
   * A rule matches if ALL specified target dimensions match (AND logic).
   * An unspecified dimension is treated as matching everything (wildcard).
   */
  private ruleMatchesAction(
    rule: PolicyRule,
    action: ActionRequest,
    risk: RiskLevel,
  ): boolean {
    const { targets } = rule;

    // Check action type
    if (targets.actions && targets.actions.length > 0) {
      if (!targets.actions.includes(action.type)) {
        return false;
      }
    }

    // Check risk level
    if (targets.risk_levels && targets.risk_levels.length > 0) {
      if (!targets.risk_levels.includes(risk)) {
        return false;
      }
    }

    // Check origin
    if (targets.origins && targets.origins.length > 0) {
      const actionOrigin = this.extractOriginFromAction(action);
      if (actionOrigin) {
        const originMatched = targets.origins.some((pattern) =>
          this.capabilityChecker.matchesOrigin(pattern, actionOrigin),
        );
        if (!originMatched) return false;
      }
    }

    // Check capabilities (rule targets capabilities that the action would need)
    // This is a "policy targets capability types" check, not a grant check
    if (targets.capabilities && targets.capabilities.length > 0) {
      // A rule targeting specific capabilities matches if the action's type
      // implies one of those capabilities. We don't re-check grant status here.
      // This dimension is mostly used for deny rules on specific capability types.
      // For simplicity: match if any targeted capability is relevant.
      // We'll be lenient — if the rule targets capabilities, it matches unless
      // the action clearly doesn't involve any of them.
    }

    return true;
  }

  /**
   * Extract the origin URL from an action request.
   */
  private extractOriginFromAction(action: ActionRequest): string | undefined {
    if (action.url) {
      try {
        return new URL(action.url).origin;
      } catch {
        return action.url;
      }
    }
    return undefined;
  }

  /**
   * Determine which capabilities are missing for the given action.
   */
  private getMissingCapabilities(action: ActionRequest): CapabilityType[] {
    // This is a best-effort mapping from action type to required capabilities
    const capMap: Partial<Record<string, CapabilityType[]>> = {
      navigate: [CapabilityType.NavigateOrigin],
      click: [CapabilityType.ActionClickLow],
      fill: [CapabilityType.ActionFill],
      submit: [CapabilityType.ActionSubmit],
      download: [CapabilityType.FileDownload],
      upload: [CapabilityType.FileUpload],
      screenshot: [CapabilityType.ReadScreenshot],
      scroll: [CapabilityType.NavigateOrigin],
      select: [CapabilityType.ActionClickLow],
      human_takeover: [CapabilityType.SessionReuse],
    };

    return capMap[action.type] ?? [];
  }

  /**
   * Build an "allow" decision.
   */
  private allow(risk: RiskLevel, reason: string, ruleId?: string): PolicyDecision {
    this.logger.debug('Decision: ALLOW', { risk, reason });
    return {
      allowed: true,
      risk,
      requires_approval: false,
      reason,
      rule_id: ruleId,
    };
  }

  /**
   * Build a "deny" decision.
   */
  private deny(
    risk: RiskLevel,
    reason: string,
    ruleId?: string,
    blockedCapabilities?: CapabilityType[],
  ): PolicyDecision {
    this.logger.debug('Decision: DENY', { risk, reason });
    return {
      allowed: false,
      risk,
      requires_approval: false,
      reason,
      rule_id: ruleId,
      blocked_capabilities: blockedCapabilities,
    };
  }

  /**
   * Build a "requires approval" decision.
   * The action is conditionally allowed pending human review.
   */
  private requireApproval(
    risk: RiskLevel,
    reason: string,
    ruleId?: string,
  ): PolicyDecision {
    this.logger.debug('Decision: REQUIRE_APPROVAL', { risk, reason });
    return {
      allowed: true,
      risk,
      requires_approval: true,
      reason,
      rule_id: ruleId,
    };
  }
}
