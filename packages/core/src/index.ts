// ─── AgentBridge Core ────────────────────────────────────────────────────────
// Shared foundation library for the AgentBridge platform.
// Pure TypeScript — no runtime dependencies on Node or browser APIs (except crypto).

// Types & Enums
export type {
  User,
  UserPreferences,
  Agent,
  Task,
  Space,
  TabInfo,
  PolicyContext,
  SitePolicy,
  ApiRoute,
  TrafficBudgetConfig,
  CapabilityGrant,
  Snapshot,
  FrameInfo,
  Region,
  ElementRef,
  LocatorSet,
  FormInfo,
  FormField,
  TableInfo,
  SnapshotWarning,
  RedactionInfo,
  SnapshotConfidence,
  Approval,
  ApprovalDiff,
  ActionRequest,
  Skill,
  SkillManifest,
  SkillIO,
  SkillStep,
  SkillValidation,
  AuditEvent,
  Secret,
  Policy,
  PolicyRule,
  PolicyDecision,
  RouteResolution,
  EvidenceReceipt,
  EgressSummary,
} from './types.js';

export {
  TaskMode,
  TaskStatus,
  RiskLevel,
  SitePolicyState,
  CapabilityType,
  ApprovalDecision,
  TaskAccessPattern,
  ExecutionRoute,
  ChallengeType,
  AuditEventType,
  GrantDuration,
  ActionType,
  AgentBridgeError,
  CapabilityDeniedError,
  ApprovalRequiredError,
  SiteBlockedError,
  ChallengeDetectedError,
  TrafficBudgetExceededError,
  ProhibitedActionError,
} from './types.js';

// Utils
export {
  generateId,
  generateShortId,
  sha256,
  hmacSha256,
  randomHex,
  hashObject,
  now,
  monotonicMs,
  isExpired,
  durationMs,
  addMs,
  Logger,
  LogLevel,
  createLogger,
} from './utils/index.js';

// Policy Engine
export { PolicyEngine } from './policy/index.js';
export { RiskClassifier } from './policy/index.js';
export { CapabilityChecker } from './policy/index.js';
export { PolicyDSL } from './policy/index.js';

// Restriction Compliance Layer
export { RestrictionComplianceLayer } from './compliance/index.js';
export { TaskClassifier } from './compliance/index.js';
export { SitePolicyRegistry } from './compliance/index.js';
export { TrafficBudget } from './compliance/index.js';
export { ChallengeDetector } from './compliance/index.js';
export { RouteResolver } from './compliance/index.js';

// Evidence
export { EvidenceLedger } from './evidence/index.js';
export { ReceiptBuilder } from './evidence/index.js';
export { HashChain } from './evidence/index.js';
export { Redactor } from './evidence/index.js';

// Auth
export { BridgeAuth } from './auth/index.js';
export { TokenStore } from './auth/index.js';
