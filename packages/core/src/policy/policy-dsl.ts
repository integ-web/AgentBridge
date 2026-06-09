import type { Policy, PolicyRule } from '../types.js';
import { ActionType, CapabilityType, RiskLevel } from '../types.js';
import { generateId, now, createLogger } from '../utils/index.js';

/**
 * Raw JSON shape for a policy rule definition.
 * This is the input format that users or enterprise admins write;
 * the DSL parser validates and converts it into a {@link PolicyRule}.
 */
export interface RawPolicyRule {
  /** Optional ID; auto-generated if omitted. */
  id?: string;
  /** Rule type: allow, deny, require_approval, require_api, rate_limit. */
  type: string;
  /** Targets this rule applies to. */
  targets: {
    origins?: string[];
    capabilities?: string[];
    actions?: string[];
    risk_levels?: string[];
    data_classes?: string[];
  };
  /** Optional additional conditions (opaque key-value). */
  conditions?: Record<string, unknown>;
  /** Priority: higher number = evaluated first. */
  priority: number;
  /** Human-readable description of the rule. */
  description: string;
}

/**
 * Raw JSON shape for a complete policy definition.
 */
export interface RawPolicy {
  /** Optional ID; auto-generated if omitted. */
  id?: string;
  /** Policy scope. */
  scope: 'user' | 'team' | 'enterprise';
  /** List of rules in this policy. */
  rules: RawPolicyRule[];
  /** Semantic version string. */
  version?: string;
  /** ISO 8601 effective date; defaults to now. */
  effective_at?: string;
  /** Creator identifier. */
  created_by?: string;
}

/** Valid rule types. */
const VALID_RULE_TYPES: ReadonlySet<string> = new Set([
  'allow',
  'deny',
  'require_approval',
  'require_api',
  'rate_limit',
]);

/** Lookup tables for enum validation. */
const VALID_ACTION_TYPES: ReadonlySet<string> = new Set(Object.values(ActionType));
const VALID_CAPABILITY_TYPES: ReadonlySet<string> = new Set(Object.values(CapabilityType));
const VALID_RISK_LEVELS: ReadonlySet<string> = new Set(Object.values(RiskLevel));
const VALID_SCOPES: ReadonlySet<string> = new Set(['user', 'team', 'enterprise']);

/**
 * Parses JSON policy definitions into fully typed {@link Policy} objects.
 *
 * The DSL supports five rule types:
 * - **allow** — Explicitly permits matching actions
 * - **deny** — Explicitly blocks matching actions
 * - **require_approval** — Allows but requires human approval
 * - **require_api** — Redirects to official API route
 * - **rate_limit** — Permits with rate constraints (specified in conditions)
 *
 * Each rule targets a combination of origins, capabilities, actions,
 * risk levels, and data classes. Rules are sorted by priority
 * (descending) at parse time for efficient evaluation.
 *
 * @example
 * ```ts
 * const dsl = new PolicyDSL();
 * const policy = dsl.parse({
 *   scope: 'enterprise',
 *   rules: [{
 *     type: 'deny',
 *     targets: { risk_levels: ['prohibited'] },
 *     priority: 1000,
 *     description: 'Block all prohibited actions',
 *   }],
 * });
 * ```
 */
export class PolicyDSL {
  private readonly logger = createLogger('PolicyDSL');

  /**
   * Parse a raw JSON policy definition into a typed {@link Policy}.
   *
   * @param raw - The raw JSON policy definition.
   * @returns A validated, typed {@link Policy} object with rules sorted by priority.
   * @throws {Error} If the policy definition is invalid.
   */
  parse(raw: RawPolicy): Policy {
    this.validateScope(raw.scope);

    const rules: PolicyRule[] = raw.rules.map((rawRule, index) =>
      this.parseRule(rawRule, index),
    );

    // Sort rules by priority descending (highest priority first)
    rules.sort((a, b) => b.priority - a.priority);

    const policy: Policy = {
      id: raw.id ?? generateId(),
      scope: raw.scope,
      rules,
      version: raw.version ?? '1.0.0',
      effective_at: raw.effective_at ?? now(),
      created_by: raw.created_by ?? 'system',
    };

    this.logger.info('Parsed policy', {
      policy_id: policy.id,
      scope: policy.scope,
      rule_count: String(rules.length),
    });

    return policy;
  }

  /**
   * Parse multiple raw policies at once.
   *
   * @param rawPolicies - Array of raw policy definitions.
   * @returns Array of validated, typed {@link Policy} objects.
   */
  parseMany(rawPolicies: RawPolicy[]): Policy[] {
    return rawPolicies.map((raw) => this.parse(raw));
  }

  /**
   * Serialize a typed {@link Policy} back to a raw JSON shape.
   * Useful for exporting or persisting policies.
   *
   * @param policy - The typed policy to serialize.
   * @returns A raw JSON-compatible policy definition.
   */
  serialize(policy: Policy): RawPolicy {
    return {
      id: policy.id,
      scope: policy.scope,
      rules: policy.rules.map((rule): RawPolicyRule => ({
        id: rule.id,
        type: rule.type,
        targets: {
          origins: rule.targets.origins,
          capabilities: rule.targets.capabilities as string[] | undefined,
          actions: rule.targets.actions as string[] | undefined,
          risk_levels: rule.targets.risk_levels as string[] | undefined,
          data_classes: rule.targets.data_classes,
        },
        conditions: rule.conditions,
        priority: rule.priority,
        description: rule.description,
      })),
      version: policy.version,
      effective_at: policy.effective_at,
      created_by: policy.created_by,
    };
  }

  /**
   * Validate and parse a single rule from raw JSON into a {@link PolicyRule}.
   */
  private parseRule(raw: RawPolicyRule, index: number): PolicyRule {
    // Validate rule type
    if (!VALID_RULE_TYPES.has(raw.type)) {
      throw new Error(
        `Invalid rule type '${raw.type}' at index ${index}. ` +
        `Valid types: ${[...VALID_RULE_TYPES].join(', ')}`,
      );
    }

    // Validate and normalize targets
    const capabilities = this.validateEnumArray(
      raw.targets.capabilities,
      VALID_CAPABILITY_TYPES,
      'capability',
      index,
    ) as CapabilityType[] | undefined;

    const actions = this.validateEnumArray(
      raw.targets.actions,
      VALID_ACTION_TYPES,
      'action',
      index,
    ) as ActionType[] | undefined;

    const riskLevels = this.validateEnumArray(
      raw.targets.risk_levels,
      VALID_RISK_LEVELS,
      'risk_level',
      index,
    ) as RiskLevel[] | undefined;

    // Validate priority is a non-negative number
    if (typeof raw.priority !== 'number' || raw.priority < 0) {
      throw new Error(
        `Invalid priority '${raw.priority}' at rule index ${index}. ` +
        `Priority must be a non-negative number.`,
      );
    }

    const rule: PolicyRule = {
      id: raw.id ?? generateId(),
      type: raw.type as PolicyRule['type'],
      targets: {
        origins: raw.targets.origins,
        capabilities,
        actions,
        risk_levels: riskLevels,
        data_classes: raw.targets.data_classes,
      },
      conditions: raw.conditions,
      priority: raw.priority,
      description: raw.description ?? '',
    };

    return rule;
  }

  /**
   * Validate that a scope string is one of the allowed values.
   */
  private validateScope(scope: string): void {
    if (!VALID_SCOPES.has(scope)) {
      throw new Error(
        `Invalid policy scope '${scope}'. Valid scopes: ${[...VALID_SCOPES].join(', ')}`,
      );
    }
  }

  /**
   * Validate an array of enum string values against a known set.
   * Returns undefined if the input is undefined/empty.
   *
   * @throws {Error} If any value is not in the valid set.
   */
  private validateEnumArray(
    values: string[] | undefined,
    validSet: ReadonlySet<string>,
    fieldName: string,
    ruleIndex: number,
  ): string[] | undefined {
    if (!values || values.length === 0) {
      return undefined;
    }

    for (const value of values) {
      if (!validSet.has(value)) {
        throw new Error(
          `Invalid ${fieldName} '${value}' at rule index ${ruleIndex}. ` +
          `Valid values: ${[...validSet].join(', ')}`,
        );
      }
    }

    return values;
  }
}
