/**
 * @module policy
 *
 * AgentBridge Policy Engine — evaluates, classifies, and enforces
 * permission decisions for browser actions requested by AI agents.
 *
 * @example
 * ```ts
 * import { PolicyEngine, RiskClassifier, CapabilityChecker, PolicyDSL } from './policy/index.js';
 *
 * const dsl = new PolicyDSL();
 * const policies = [dsl.parse(rawPolicy)];
 * const engine = new PolicyEngine(policies, grants);
 * const decision = engine.evaluate(actionRequest);
 * ```
 */

export { PolicyEngine } from './policy-engine.js';
export { RiskClassifier } from './risk-classifier.js';
export { CapabilityChecker } from './capability-checker.js';
export type { CapabilityCheckResult } from './capability-checker.js';
export { PolicyDSL } from './policy-dsl.js';
export type { RawPolicy, RawPolicyRule } from './policy-dsl.js';
