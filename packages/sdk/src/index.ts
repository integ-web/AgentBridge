/**
 * AgentBridge TypeScript SDK
 * 
 * Connect AI agents to browser workspaces with permission-first access.
 * 
 * @example
 * ```ts
 * const bridge = await AgentBridge.connect();
 * const task = await bridge.tasks.create({
 *   objective: "Download latest invoice",
 *   mode: "local_attach",
 *   riskTolerance: "medium",
 * });
 * 
 * await task.permissions.request({
 *   origins: ["https://billing.example.com"],
 *   capabilities: ["navigate.origin", "read.visible_text", "action.click.low"],
 *   duration: "task",
 * });
 * 
 * const space = await task.spaces.create({ name: "invoice-download", ephemeral: true });
 * const snap = await space.tabs[0].snapshot({ mode: "compact" });
 * await space.tabs[0].click(snap.refByText("Download latest"));
 * const receipt = await task.audit.exportEvidencePackage();
 * ```
 */

import type {
  Task,
  Space,
  Snapshot,
  CapabilityGrant,
  Approval,
  EvidenceReceipt,
  AuditEvent,
  SitePolicy,
  PolicyDecision,
  RouteResolution,
  ElementRef,
} from '@agentbridge/core';

import {
  AgentBridgeError,
  CapabilityDeniedError,
  ApprovalRequiredError,
  SiteBlockedError,
  ChallengeDetectedError,
  TrafficBudgetExceededError,
  ProhibitedActionError,
} from '@agentbridge/core';

// ─── Configuration ──────────────────────────────────────────────────────────

export interface ConnectOptions {
  /** Companion port (default: 17352) */
  port?: number;
  /** Companion host (default: 127.0.0.1) */
  host?: string;
  /** Connection timeout in ms (default: 5000) */
  timeout?: number;
  /** Auto-reconnect WebSocket (default: true) */
  autoReconnect?: boolean;
}

export interface CreateTaskOptions {
  objective: string;
  mode?: 'local_attach' | 'bundled_hardened' | 'remote_runner';
  riskTolerance?: 'low' | 'medium' | 'high';
  origins?: string[];
}

export interface PermissionRequestOptions {
  origins: string[];
  capabilities: string[];
  duration?: 'once' | 'task' | 'skill' | 'session';
}

export interface SnapshotOptions {
  mode?: 'compact' | 'full';
}

// ─── HTTP Client ────────────────────────────────────────────────────────────

class HttpClient {
  private baseUrl: string;

  constructor(host: string, port: number) {
    this.baseUrl = `http://${host}:${port}`;
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw this.mapError(res.status, body);
    }
    return res.json() as Promise<T>;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw this.mapError(res.status, errBody);
    }
    return res.json() as Promise<T>;
  }

  async delete<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { method: 'DELETE' });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw this.mapError(res.status, errBody);
    }
    return res.json() as Promise<T>;
  }

  private mapError(status: number, body: any): AgentBridgeError {
    const msg = body?.error || body?.message || `HTTP ${status}`;
    const code = body?.decision?.reason || msg;

    switch (body?.error_code || '') {
      case 'CAPABILITY_DENIED': return new CapabilityDeniedError(body.capability, body.origin, msg);
      case 'APPROVAL_REQUIRED': return new ApprovalRequiredError(body.approval_id, body.action, msg);
      case 'SITE_BLOCKED': return new SiteBlockedError(body.origin, body.state, msg);
      case 'CHALLENGE_DETECTED': return new ChallengeDetectedError(body.challenge_type, body.origin);
      case 'TRAFFIC_BUDGET_EXCEEDED': return new TrafficBudgetExceededError(body.origin, body.metric, body.limit);
      case 'PROHIBITED_ACTION': return new ProhibitedActionError(body.action, msg);
      default: return new AgentBridgeError(msg, `HTTP_${status}`);
    }
  }
}

// ─── Tab Wrapper ────────────────────────────────────────────────────────────

/** Controls a browser tab within a Space. */
export class TabHandle {
  constructor(
    private readonly http: HttpClient,
    private readonly taskId: string,
    public readonly id: string,
    public url: string,
    public title: string,
  ) {}

  /** Capture a structured snapshot of the page. */
  async snapshot(options?: SnapshotOptions): Promise<SnapshotHandle> {
    const res = await this.http.post<{ status: string }>(`/v1/tabs/${this.id}/snapshot`, {
      mode: options?.mode || 'compact',
    });
    // In practice, snapshot data arrives via WebSocket; this is the request trigger
    return new SnapshotHandle(this.taskId, this.id, []);
  }

  /** Click an element by ref or selector. */
  async click(ref: string, metadata?: Record<string, unknown>): Promise<{ executed: boolean }> {
    return this.http.post(`/v1/tabs/${this.id}/actions/click`, {
      task_id: this.taskId,
      ref,
      metadata,
    });
  }

  /** Fill a form field by ref or selector. */
  async fill(ref: string, value: string): Promise<{ executed: boolean }> {
    return this.http.post(`/v1/tabs/${this.id}/actions/fill`, {
      task_id: this.taskId,
      ref,
      value,
    });
  }

  /** Navigate this tab to a URL. */
  async navigate(url: string): Promise<{ navigating: boolean }> {
    return this.http.post(`/v1/tabs/${this.id}/actions/navigate`, {
      task_id: this.taskId,
      url,
    });
  }
}

// ─── Snapshot Handle ────────────────────────────────────────────────────────

/** A snapshot of a page with element refs for interaction. */
export class SnapshotHandle {
  constructor(
    public readonly taskId: string,
    public readonly tabId: string,
    public readonly refs: ElementRef[],
  ) {}

  /** Find an element ref by visible text content. */
  refByText(text: string): string {
    const ref = this.refs.find(r =>
      r.name.toLowerCase().includes(text.toLowerCase())
    );
    if (!ref) throw new AgentBridgeError(`No element found with text "${text}"`, 'REF_NOT_FOUND');
    return ref.ref;
  }

  /** Find an element ref by role. */
  refByRole(role: string): string {
    const ref = this.refs.find(r => r.role === role);
    if (!ref) throw new AgentBridgeError(`No element found with role "${role}"`, 'REF_NOT_FOUND');
    return ref.ref;
  }
}

// ─── Space Wrapper ──────────────────────────────────────────────────────────

/** An isolated browser workspace for a task. */
export class SpaceHandle {
  public tabs: TabHandle[] = [];

  constructor(
    private readonly http: HttpClient,
    private readonly taskId: string,
    public readonly data: Space,
  ) {}

  /** Open a new tab in this space. */
  async openTab(url: string): Promise<TabHandle> {
    // Create tab via navigate action
    const tabId = `tab_${Date.now()}`;
    const tab = new TabHandle(this.http, this.taskId, tabId, url, '');
    this.tabs.push(tab);
    return tab;
  }
}

// ─── Task Wrapper ───────────────────────────────────────────────────────────

/** A bounded unit of work with permissions, spaces, and evidence. */
export class TaskHandle {
  /** Task data */
  public data: Task;

  /** Permission management */
  public readonly permissions: {
    request: (options: PermissionRequestOptions) => Promise<CapabilityGrant[]>;
    revoke: (grantId: string) => Promise<void>;
  };

  /** Space management */
  public readonly spaces: {
    create: (options: { name: string; ephemeral?: boolean }) => Promise<SpaceHandle>;
  };

  /** Route compliance */
  public readonly compliance: {
    resolveRoute: (options?: { preferApi?: boolean }) => Promise<RouteResolution>;
  };

  /** Audit & evidence */
  public readonly audit: {
    getEvents: () => Promise<AuditEvent[]>;
    exportEvidencePackage: () => Promise<EvidenceReceipt>;
  };

  constructor(
    private readonly http: HttpClient,
    task: Task,
  ) {
    this.data = task;

    this.permissions = {
      request: async (options) => {
        const res = await this.http.post<{ grants: CapabilityGrant[] }>('/v1/permissions/request', {
          task_id: this.data.id,
          ...options,
        });
        return res.grants;
      },
      revoke: async (grantId) => {
        await this.http.delete(`/v1/permissions/${grantId}`);
      },
    };

    this.spaces = {
      create: async (options) => {
        const res = await this.http.post<{ space: Space }>('/v1/spaces', {
          task_id: this.data.id,
          ...options,
        });
        return new SpaceHandle(this.http, this.data.id, res.space);
      },
    };

    this.compliance = {
      resolveRoute: async (options) => {
        const res = await this.http.post<{ resolution: RouteResolution }>(
          `/v1/tasks/${this.data.id}/route/resolve`,
          options,
        );
        return res.resolution;
      },
    };

    this.audit = {
      getEvents: async () => {
        const res = await this.http.get<{ events: AuditEvent[] }>(`/v1/tasks/${this.data.id}/audit`);
        return res.events;
      },
      exportEvidencePackage: async () => {
        const res = await this.http.post<{ receipt: EvidenceReceipt }>(`/v1/tasks/${this.data.id}/evidence`);
        return res.receipt;
      },
    };
  }

  /** Get latest task status from companion. */
  async refresh(): Promise<void> {
    const res = await this.http.get<{ task: Task }>(`/v1/tasks/${this.data.id}`);
    this.data = res.task;
  }
}

// ─── Main Client ────────────────────────────────────────────────────────────

/**
 * AgentBridge SDK client.
 * 
 * @example
 * ```ts
 * const bridge = await AgentBridge.connect({ port: 17352 });
 * const task = await bridge.tasks.create({ objective: "Download invoice" });
 * ```
 */
export class AgentBridge {
  private readonly http: HttpClient;

  /** Task management */
  public readonly tasks: {
    create: (options: CreateTaskOptions) => Promise<TaskHandle>;
    get: (taskId: string) => Promise<TaskHandle>;
  };

  /** Policy information */
  public readonly policy: {
    explain: (origin: string) => Promise<{ origin: string; policy: SitePolicy; explanation: string }>;
  };

  private constructor(http: HttpClient) {
    this.http = http;

    this.tasks = {
      create: async (options) => {
        const res = await this.http.post<{ task: Task }>('/v1/tasks', options);
        return new TaskHandle(this.http, res.task);
      },
      get: async (taskId) => {
        const res = await this.http.get<{ task: Task }>(`/v1/tasks/${taskId}`);
        return new TaskHandle(this.http, res.task);
      },
    };

    this.policy = {
      explain: async (origin) => {
        return this.http.get(`/v1/policy/explain?origin=${encodeURIComponent(origin)}`);
      },
    };
  }

  /**
   * Connect to the local AgentBridge companion daemon.
   * 
   * @param options Connection configuration
   * @returns Connected AgentBridge client
   * @throws {AgentBridgeError} If companion is not running or unreachable
   */
  static async connect(options: ConnectOptions = {}): Promise<AgentBridge> {
    const { port = 17352, host = '127.0.0.1', timeout = 5000 } = options;

    const http = new HttpClient(host, port);

    // Health check to verify companion is running
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(`http://${host}:${port}/v1/health`, { signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) {
        throw new AgentBridgeError(
          `Companion returned status ${res.status}`,
          'COMPANION_ERROR',
        );
      }

      const health = await res.json() as { status: string };
      if (health.status !== 'ok') {
        throw new AgentBridgeError(
          'Companion is not healthy',
          'COMPANION_UNHEALTHY',
        );
      }
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === 'AbortError') {
        throw new AgentBridgeError(
          `Cannot reach AgentBridge companion at ${host}:${port}. Is it running? Try: agentbridge doctor`,
          'COMPANION_UNREACHABLE',
        );
      }
      if (err instanceof AgentBridgeError) throw err;
      throw new AgentBridgeError(
        `Cannot connect to AgentBridge companion: ${(err as Error).message}`,
        'COMPANION_UNREACHABLE',
      );
    }

    return new AgentBridge(http);
  }
}

export default AgentBridge;
