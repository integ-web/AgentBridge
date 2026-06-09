// ─── Enums ───────────────────────────────────────────────────────────────────

/** Execution mode for a task's browser workspace. */
export enum TaskMode {
  /** Controlled access to the user's existing browser state for approved domains. */
  LocalAttach = 'local_attach',
  /** Hardened browser environment with stronger isolation. */
  BundledHardened = 'bundled_hardened',
  /** Long-running non-sensitive jobs on remote infrastructure. */
  RemoteRunner = 'remote_runner',
}

/** Lifecycle status of a task. */
export enum TaskStatus {
  Created = 'created',
  Planning = 'planning',
  Reading = 'reading',
  Acting = 'acting',
  Paused = 'paused',
  WaitingApproval = 'waiting_approval',
  Blocked = 'blocked',
  Complete = 'complete',
  Failed = 'failed',
  Stopped = 'stopped',
}

/** Risk classification for an action. */
export enum RiskLevel {
  /** Read approved public page, navigate, scroll, open menu. */
  Low = 'low',
  /** Fill draft form, filter table, download approved report. */
  Medium = 'medium',
  /** Submit form, update record, upload file, send, invite, bulk edit. */
  High = 'high',
  /** Payment, purchase, transfer, OAuth, account deletion. */
  Critical = 'critical',
  /** CAPTCHA bypass, stealth evasion, credential theft, spam. */
  Prohibited = 'prohibited',
}

/** Site policy state in the restriction registry. */
export enum SitePolicyState {
  /** Official API/export exists and user/enterprise permits it. */
  ApprovedApiFirst = 'approved_api_first',
  /** User may operate site via browser with capabilities. */
  ApprovedBrowserDelegated = 'approved_browser_delegated',
  /** Site may be viewed but not changed. */
  ReadOnly = 'read_only',
  /** CAPTCHA/MFA/security check encountered. */
  HumanOnlyChallenge = 'human_only_challenge',
  /** Site needs contractual/API integration. */
  PartnerRequired = 'partner_required',
  /** Terms, policy, law, or enterprise rule disallows task. */
  RestrictedBanned = 'restricted_banned',
  /** No policy known — conservative defaults apply. */
  Unknown = 'unknown',
}

/** Granular capability types for permission grants. */
export enum CapabilityType {
  NavigateOrigin = 'navigate.origin',
  ReadVisibleText = 'read.visible_text',
  ReadScreenshot = 'read.screenshot',
  ReadFormValues = 'read.form_values',
  ActionClickLow = 'action.click.low',
  ActionFill = 'action.fill',
  ActionSubmit = 'action.submit',
  FileDownload = 'file.download',
  FileUpload = 'file.upload',
  SessionReuse = 'session.reuse',
  ModelEgressPage = 'model.egress.page',
  SecretUse = 'secret.use',
  DevConsole = 'dev.console',
  DevNetwork = 'dev.network',
}

/** Human decision on an approval request. */
export enum ApprovalDecision {
  ApproveOnce = 'approve_once',
  Deny = 'deny',
  EditBeforeApprove = 'edit_before_approve',
  AlwaysRequire = 'always_require',
  StopTask = 'stop_task',
}

/** Task access pattern classification used by the Restriction Compliance Layer. */
export enum TaskAccessPattern {
  UserDelegated = 'user_delegated',
  CrawlLike = 'crawl_like',
  Bulk = 'bulk',
  Transactional = 'transactional',
  Regulated = 'regulated',
  DeveloperTest = 'developer_test',
  InternalOwned = 'internal_owned',
}

/** Execution route chosen by the Restriction Compliance Layer. */
export enum ExecutionRoute {
  OfficialApi = 'official_api',
  ExportEndpoint = 'export_endpoint',
  LocalAttach = 'local_attach',
  BundledBrowser = 'bundled_browser',
  RemoteRunner = 'remote_runner',
  HumanOnly = 'human_only',
  Block = 'block',
}

/** Type of challenge detected. */
export enum ChallengeType {
  Captcha = 'captcha',
  ReCaptcha = 'recaptcha',
  MFA = 'mfa',
  QRLogin = 'qr_login',
  HardwareKey = 'hardware_key',
  SuspiciousLogin = 'suspicious_login',
  AccountRecovery = 'account_recovery',
  RateLimit429 = 'rate_limit_429',
  Forbidden403 = 'forbidden_403',
  ServerError503 = 'server_error_503',
}

/** Type of audit event recorded in the evidence ledger. */
export enum AuditEventType {
  TaskCreated = 'task.created',
  TaskStarted = 'task.started',
  TaskPaused = 'task.paused',
  TaskResumed = 'task.resumed',
  TaskCompleted = 'task.completed',
  TaskFailed = 'task.failed',
  TaskStopped = 'task.stopped',
  SpaceCreated = 'space.created',
  SpaceDestroyed = 'space.destroyed',
  PermissionGranted = 'permission.granted',
  PermissionRevoked = 'permission.revoked',
  PermissionDenied = 'permission.denied',
  PolicyChecked = 'policy.checked',
  PolicyBlocked = 'policy.blocked',
  RouteResolved = 'route.resolved',
  SnapshotCaptured = 'snapshot.captured',
  ActionRequested = 'action.requested',
  ActionExecuted = 'action.executed',
  ActionBlocked = 'action.blocked',
  ApprovalRequired = 'approval.required',
  ApprovalDecided = 'approval.decided',
  ChallengeDetected = 'challenge.detected',
  ChallengeHandled = 'challenge.handled',
  TrafficBudgetWarning = 'traffic.budget_warning',
  TrafficBudgetExceeded = 'traffic.budget_exceeded',
  DataEgress = 'data.egress',
  FileDownloaded = 'file.downloaded',
  FileUploaded = 'file.uploaded',
  SecretUsed = 'secret.used',
  RedactionApplied = 'redaction.applied',
  InjectionDetected = 'injection.detected',
  ErrorOccurred = 'error.occurred',
}

/** Grant duration for a capability. */
export enum GrantDuration {
  Once = 'once',
  Task = 'task',
  Skill = 'skill',
  Session = 'session',
  AdminManaged = 'admin_managed',
}

/** Browser action types. */
export enum ActionType {
  Navigate = 'navigate',
  Click = 'click',
  Fill = 'fill',
  Scroll = 'scroll',
  Download = 'download',
  Upload = 'upload',
  Submit = 'submit',
  Select = 'select',
  Screenshot = 'screenshot',
  HumanTakeover = 'human_takeover',
}

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** A user of AgentBridge. Supports local anonymous mode. */
export interface User {
  id: string;
  profile?: {
    name?: string;
    email?: string;
  };
  preferences: UserPreferences;
  org_id?: string;
  created_at: string;
}

export interface UserPreferences {
  default_mode: TaskMode;
  privacy_mode: 'local_only' | 'standard';
  telemetry_enabled: boolean;
}

/** An AI agent registered with AgentBridge. */
export interface Agent {
  id: string;
  name: string;
  provider: string;
  trust_level: 'untrusted' | 'known' | 'verified' | 'managed';
  connected_at?: string;
  capabilities_requested?: CapabilityType[];
}

/** A bounded user objective with policy context. */
export interface Task {
  id: string;
  objective: string;
  mode: TaskMode;
  status: TaskStatus;
  risk: RiskLevel;
  access_pattern: TaskAccessPattern;
  requester: {
    user_id: string;
    agent_id: string;
  };
  space_id?: string;
  origins: string[];
  risk_tolerance: RiskLevel;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  error?: string;
}

/** An isolated browser workspace for a task. */
export interface Space {
  id: string;
  task_id: string;
  name: string;
  tabs: TabInfo[];
  storage_mode: 'ephemeral' | 'persistent';
  policy_context: PolicyContext;
  created_at: string;
  destroyed_at?: string;
}

export interface TabInfo {
  id: string;
  url: string;
  title: string;
  origin: string;
  status: 'loading' | 'ready' | 'error' | 'closed';
}

export interface PolicyContext {
  mode: TaskMode;
  granted_capabilities: CapabilityGrant[];
  site_policies: SitePolicy[];
  traffic_budgets: TrafficBudgetConfig[];
}

/** Domain-level site policy entry in the restriction registry. */
export interface SitePolicy {
  origin: string;
  state: SitePolicyState;
  api_routes?: ApiRoute[];
  traffic_budget: TrafficBudgetConfig;
  legal_status: 'reviewed' | 'unreviewed' | 'restricted';
  robots_notes?: string;
  terms_notes?: string;
  last_reviewed?: string;
  reviewed_by?: string;
  prohibited_actions?: ActionType[];
  allowed_capabilities?: CapabilityType[];
}

export interface ApiRoute {
  name: string;
  endpoint: string;
  method: string;
  auth_type: 'oauth' | 'api_key' | 'bearer' | 'none';
  description: string;
}

/** Configuration for per-origin traffic budgets. */
export interface TrafficBudgetConfig {
  origin: string;
  max_concurrent_tasks: number;
  requests_per_minute: number;
  max_retries: number;
  backoff_base_ms: number;
  backoff_max_ms: number;
  max_downloads_per_task: number;
  max_download_size_mb: number;
  max_scroll_depth: number;
  max_tabs: number;
}

/** A granular permission for a data access or action. */
export interface CapabilityGrant {
  id: string;
  task_id: string;
  origin: string;
  capability: CapabilityType;
  data_class?: string;
  duration: GrantDuration;
  expires_at?: string;
  granted_at: string;
  granted_by: 'user' | 'policy' | 'skill' | 'admin';
  revoked_at?: string;
}

/** Structured page representation with refs, confidence, redactions. */
export interface Snapshot {
  snapshot_id: string;
  task_id: string;
  space_id: string;
  tab_id: string;
  url: string;
  title: string;
  timestamp: string;
  mode: TaskMode;
  viewport: { width: number; height: number };
  scroll: { x: number; y: number; max_x: number; max_y: number };
  frames: FrameInfo[];
  regions: Region[];
  refs: ElementRef[];
  forms: FormInfo[];
  tables: TableInfo[];
  warnings: SnapshotWarning[];
  redactions: RedactionInfo[];
  confidence: SnapshotConfidence;
  policy_context: {
    capabilities: CapabilityType[];
    restrictions: string[];
  };
}

export interface FrameInfo {
  id: string;
  origin: string;
  sandbox: boolean;
  accessible: boolean;
}

export interface Region {
  id: string;
  role: string;
  label?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  refs: string[];
}

/** Actionable element reference with locator strategies and risk. */
export interface ElementRef {
  ref: string;
  role: string;
  name: string;
  locator_set: LocatorSet;
  risk: RiskLevel;
  confidence: number;
  actionable: boolean;
  visible: boolean;
  value?: string;
  attributes?: Record<string, string>;
}

export interface LocatorSet {
  handle_id?: string;
  css_selector?: string;
  xpath?: string;
  accessibility_path?: string;
  label?: string;
  text_anchor?: string;
  layout_proximity?: { near_ref: string; direction: string; distance: number };
}

export interface FormInfo {
  id: string;
  action?: string;
  method?: string;
  fields: FormField[];
}

export interface FormField {
  ref: string;
  name: string;
  type: string;
  label?: string;
  value?: string;
  required: boolean;
  redacted: boolean;
}

export interface TableInfo {
  ref: string;
  headers: string[];
  row_count: number;
  sample_rows?: string[][];
}

export interface SnapshotWarning {
  type: 'offscreen' | 'image_text' | 'canvas' | 'cross_origin_iframe' | 'hidden_field' | 'overlay' | 'low_confidence' | 'dynamic_content';
  message: string;
  refs?: string[];
}

export interface RedactionInfo {
  ref?: string;
  field?: string;
  reason: 'secret' | 'token' | 'auth_header' | 'password' | 'pii' | 'payment' | 'enterprise_sensitive';
  pattern: string;
}

export interface SnapshotConfidence {
  page_coverage: number;
  element_identity: number;
  click_fill_confidence: number;
  risk_classification: number;
  overall: number;
}

/** Human decision record for a high-risk action. */
export interface Approval {
  id: string;
  task_id: string;
  action: ActionRequest;
  diff: ApprovalDiff;
  decision?: ApprovalDecision;
  reviewer?: string;
  decided_at?: string;
  hash: string;
  policy_reason: string;
  created_at: string;
}

export interface ApprovalDiff {
  summary: string;
  target: string;
  data: Record<string, unknown>;
  consequence: string;
  agent_reason: string;
  reversible: boolean;
}

/** An action request from an agent. */
export interface ActionRequest {
  id: string;
  task_id: string;
  tab_id: string;
  type: ActionType;
  ref?: string;
  value?: string;
  url?: string;
  metadata?: Record<string, unknown>;
  risk: RiskLevel;
  timestamp: string;
}

/** A versioned, testable, signed reusable workflow. */
export interface Skill {
  id: string;
  name: string;
  version: string;
  owner: string;
  description: string;
  manifest: SkillManifest;
  validation: SkillValidation;
  created_at: string;
  updated_at: string;
}

export interface SkillManifest {
  domain_patterns: string[];
  inputs: SkillIO[];
  outputs: SkillIO[];
  required_capabilities: CapabilityType[];
  model_egress_needs: boolean;
  traffic_budget: Partial<TrafficBudgetConfig>;
  risk_profile: RiskLevel;
  safety_gates: string[];
  steps: SkillStep[];
  fallback_strategies: string[];
}

export interface SkillIO {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

export interface SkillStep {
  id: string;
  description: string;
  action: ActionType;
  ref_strategy: string;
  fallback?: string;
}

export interface SkillValidation {
  status: 'draft' | 'validated' | 'signed' | 'deprecated';
  last_tested: string;
  test_results: { passed: number; failed: number; skipped: number };
  signature?: string;
  checksum?: string;
}

/** Append-only audit event in the evidence ledger. */
export interface AuditEvent {
  id: string;
  task_id: string;
  type: AuditEventType;
  timestamp: string;
  redacted_payload: Record<string, unknown>;
  chain_hash: string;
  previous_hash: string;
}

/** Secret reference (value lives in OS keychain, never in app DB). */
export interface Secret {
  id: string;
  vault_ref: string;
  domains: string[];
  skills: string[];
  label: string;
  created_at: string;
}

/** User/team/enterprise policy definition. */
export interface Policy {
  id: string;
  scope: 'user' | 'team' | 'enterprise';
  rules: PolicyRule[];
  version: string;
  effective_at: string;
  created_by: string;
}

export interface PolicyRule {
  id: string;
  type: 'allow' | 'deny' | 'require_approval' | 'require_api' | 'rate_limit';
  targets: {
    origins?: string[];
    capabilities?: CapabilityType[];
    actions?: ActionType[];
    risk_levels?: RiskLevel[];
    data_classes?: string[];
  };
  conditions?: Record<string, unknown>;
  priority: number;
  description: string;
}

// ─── Result Types ────────────────────────────────────────────────────────────

/** Result of a policy decision. */
export interface PolicyDecision {
  allowed: boolean;
  risk: RiskLevel;
  requires_approval: boolean;
  reason: string;
  rule_id?: string;
  alternative_route?: ExecutionRoute;
  blocked_capabilities?: CapabilityType[];
}

/** Result of route resolution by the RCL. */
export interface RouteResolution {
  route: ExecutionRoute;
  reason: string;
  api_route?: ApiRoute;
  site_policy_state: SitePolicyState;
  traffic_budget: TrafficBudgetConfig;
  warnings: string[];
}

/** Evidence receipt package for export. */
export interface EvidenceReceipt {
  task_id: string;
  objective: string;
  mode: TaskMode;
  status: TaskStatus;
  created_at: string;
  completed_at?: string;
  grants: CapabilityGrant[];
  site_policies: Array<{ origin: string; state: SitePolicyState }>;
  events: AuditEvent[];
  approvals: Approval[];
  egress_summary: EgressSummary;
  redaction_summary: { count: number; categories: string[] };
  download_hashes: Array<{ filename: string; hash: string; size: number }>;
  integrity_hash: string;
}

export interface EgressSummary {
  data_left_device: boolean;
  destinations: string[];
  data_classes: string[];
  redaction_applied: boolean;
}

// ─── Error Types ─────────────────────────────────────────────────────────────

/** Base error for AgentBridge policy violations. */
export class AgentBridgeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AgentBridgeError';
  }
}

export class CapabilityDeniedError extends AgentBridgeError {
  constructor(capability: CapabilityType, origin: string, reason: string) {
    super(
      `Capability '${capability}' denied for origin '${origin}': ${reason}`,
      'CAPABILITY_DENIED',
      { capability, origin, reason },
    );
    this.name = 'CapabilityDeniedError';
  }
}

export class ApprovalRequiredError extends AgentBridgeError {
  constructor(
    public readonly approval_id: string,
    action: ActionType,
    reason: string,
  ) {
    super(
      `Approval required for action '${action}': ${reason}`,
      'APPROVAL_REQUIRED',
      { approval_id, action, reason },
    );
    this.name = 'ApprovalRequiredError';
  }
}

export class SiteBlockedError extends AgentBridgeError {
  constructor(origin: string, state: SitePolicyState, reason: string) {
    super(
      `Site '${origin}' is blocked (${state}): ${reason}`,
      'SITE_BLOCKED',
      { origin, state, reason },
    );
    this.name = 'SiteBlockedError';
  }
}

export class ChallengeDetectedError extends AgentBridgeError {
  constructor(challenge_type: ChallengeType, origin: string) {
    super(
      `Human verification required (${challenge_type}) at '${origin}'. AgentBridge will not bypass this.`,
      'CHALLENGE_DETECTED',
      { challenge_type, origin },
    );
    this.name = 'ChallengeDetectedError';
  }
}

export class TrafficBudgetExceededError extends AgentBridgeError {
  constructor(origin: string, metric: string, limit: number) {
    super(
      `Traffic budget exceeded for '${origin}': ${metric} exceeds limit of ${limit}`,
      'TRAFFIC_BUDGET_EXCEEDED',
      { origin, metric, limit },
    );
    this.name = 'TrafficBudgetExceededError';
  }
}

export class ProhibitedActionError extends AgentBridgeError {
  constructor(action: string, reason: string) {
    super(
      `Prohibited action '${action}': ${reason}. AgentBridge does not support this.`,
      'PROHIBITED_ACTION',
      { action, reason },
    );
    this.name = 'ProhibitedActionError';
  }
}
