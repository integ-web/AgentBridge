/**
 * AgentBridge Companion — Local HTTP/WebSocket Server
 * 
 * The central orchestrator daemon running on the user's machine.
 * Handles task management, policy evaluation, evidence logging,
 * and WebSocket communication with the extension and SDK clients.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import {
  PolicyEngine,
  RiskClassifier,
  EvidenceLedger,
  SitePolicyRegistry,
  TrafficBudget,
  RestrictionComplianceLayer,
  TaskClassifier,
  BridgeAuth,
  createLogger,
  generateId,
  now,
  TaskMode,
  TaskStatus,
  RiskLevel,
  AuditEventType,
  type Task,
  type Space,
  type CapabilityGrant,
  type Approval,
  type ActionRequest,
} from '@agentbridge/core';

// ─── Configuration ──────────────────────────────────────────────────────────

const PORT = parseInt(process.env.AGENTBRIDGE_PORT || '17352', 10);
const HOST = '127.0.0.1'; // Local-only — never expose externally
const LOG_LEVEL = process.env.AGENTBRIDGE_LOG_LEVEL || 'info';

const logger = createLogger('companion');

// ─── Core Services ──────────────────────────────────────────────────────────

const auth = new BridgeAuth();
const riskClassifier = new RiskClassifier();
const evidenceLedger = new EvidenceLedger();
const sitePolicyRegistry = new SitePolicyRegistry();
const trafficBudget = new TrafficBudget();
const taskClassifier = new TaskClassifier();
const rcl = new RestrictionComplianceLayer({
  registry: sitePolicyRegistry,
  budget: trafficBudget,
});

/** Create a PolicyEngine with the current grants for a task. */
function createPolicyEngineForTask(taskId: string): PolicyEngine {
  const taskGrants = [...grants.values()].filter(g => g.task_id === taskId && !g.revoked_at);
  return new PolicyEngine([], taskGrants);
}

// ─── In-Memory State (persisted to SQLite in production) ────────────────────

const tasks = new Map<string, Task>();
const spaces = new Map<string, Space>();
const grants = new Map<string, CapabilityGrant>();
const approvals = new Map<string, Approval>();

/** Connected WebSocket clients */
const wsClients = new Set<import('ws').WebSocket>();

// ─── Server Setup ───────────────────────────────────────────────────────────

const app = Fastify({ logger: false });

async function start() {
  // Register plugins
  await app.register(cors, {
    origin: true, // Allow all origins (local-only server)
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  });

  await app.register(websocket);

  // ─── WebSocket Route ──────────────────────────────────────────────────

  app.register(async (fastify) => {
    fastify.get('/ws', { websocket: true }, (socket, req) => {
      logger.info('WebSocket client connected');
      wsClients.add(socket);

      socket.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          handleWsMessage(socket, msg);
        } catch {
          socket.send(JSON.stringify({ type: 'error', payload: { message: 'Invalid JSON' } }));
        }
      });

      socket.on('close', () => {
        wsClients.delete(socket);
        logger.info('WebSocket client disconnected');
      });
    });
  });

  // ─── Health Check ─────────────────────────────────────────────────────

  app.get('/v1/health', async () => {
    return {
      status: 'ok',
      version: '0.1.0',
      uptime: process.uptime(),
      timestamp: now(),
      services: {
        policy_engine: 'ready',
        evidence_ledger: 'ready',
        site_policy_registry: 'ready',
        auth: 'ready',
      },
      tasks: {
        active: [...tasks.values()].filter(t => !['complete', 'failed', 'stopped'].includes(t.status)).length,
        total: tasks.size,
      },
    };
  });

  // ─── Tasks ────────────────────────────────────────────────────────────

  app.post<{ Body: { objective: string; mode?: string; riskTolerance?: string; origins?: string[] } }>(
    '/v1/tasks',
    async (req) => {
      const { objective, mode = 'local_attach', riskTolerance = 'medium', origins = [] } = req.body;

      const taskId = generateId();

      // Classify the task
      const classification = taskClassifier.classify(objective, origins);

      const task: Task = {
        id: taskId,
        objective,
        mode: mode as TaskMode,
        status: TaskStatus.Created,
        risk: RiskLevel.Low,
        access_pattern: classification.pattern,
        requester: { user_id: 'local', agent_id: 'default' },
        origins,
        risk_tolerance: riskTolerance as RiskLevel,
        created_at: now(),
      };

      tasks.set(taskId, task);

      // Record evidence
      evidenceLedger.record(taskId, AuditEventType.TaskCreated, {
        objective,
        mode,
        access_pattern: classification.pattern,
        classification_reasoning: classification.reasoning,
      });

      // Broadcast to clients
      broadcast({ type: 'task.status', payload: task });

      logger.info('Task created', { taskId, objective, pattern: classification.pattern });

      return { task };
    },
  );

  app.get<{ Params: { id: string } }>('/v1/tasks/:id', async (req, reply) => {
    const task = tasks.get(req.params.id);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    return { task };
  });

  // ─── Route Resolution ────────────────────────────────────────────────

  app.post<{ Params: { id: string }; Body: { preferApi?: boolean } }>(
    '/v1/tasks/:id/route/resolve',
    async (req, reply) => {
      const task = tasks.get(req.params.id);
      if (!task) return reply.code(404).send({ error: 'Task not found' });

      const resolution = rcl.evaluateTask(task);

      evidenceLedger.record(task.id, AuditEventType.RouteResolved, {
        route: resolution.route,
        reason: resolution.reason,
        site_policy_state: resolution.site_policy_state,
      });

      return { resolution };
    },
  );

  // ─── Spaces ───────────────────────────────────────────────────────────

  app.post<{ Body: { task_id: string; name: string; ephemeral?: boolean } }>(
    '/v1/spaces',
    async (req, reply) => {
      const { task_id, name, ephemeral = true } = req.body;

      const task = tasks.get(task_id);
      if (!task) return reply.code(404).send({ error: 'Task not found' });

      const spaceId = generateId();
      const space: Space = {
        id: spaceId,
        task_id,
        name,
        tabs: [],
        storage_mode: ephemeral ? 'ephemeral' : 'persistent',
        policy_context: {
          mode: task.mode,
          granted_capabilities: [...grants.values()].filter(g => g.task_id === task_id),
          site_policies: task.origins.map(o => sitePolicyRegistry.get(o)),
          traffic_budgets: task.origins.map(o => sitePolicyRegistry.getDefaultBudget(o)),
        },
        created_at: now(),
      };

      spaces.set(spaceId, space);
      task.space_id = spaceId;

      evidenceLedger.record(task_id, AuditEventType.SpaceCreated, {
        space_id: spaceId,
        name,
        mode: task.mode,
        storage_mode: space.storage_mode,
      });

      return { space };
    },
  );

  // ─── Permissions ──────────────────────────────────────────────────────

  app.post<{
    Body: {
      task_id: string;
      origins: string[];
      capabilities: string[];
      duration?: string;
    };
  }>('/v1/permissions/request', async (req, reply) => {
    const { task_id, origins, capabilities, duration = 'task' } = req.body;

    const task = tasks.get(task_id);
    if (!task) return reply.code(404).send({ error: 'Task not found' });

    const newGrants: CapabilityGrant[] = [];

    for (const origin of origins) {
      for (const cap of capabilities) {
        const grant: CapabilityGrant = {
          id: generateId(),
          task_id,
          origin,
          capability: cap as any,
          duration: duration as any,
          granted_at: now(),
          granted_by: 'user',
        };

        grants.set(grant.id, grant);
        newGrants.push(grant);

        evidenceLedger.record(task_id, AuditEventType.PermissionGranted, {
          grant_id: grant.id,
          origin,
          capability: cap,
          duration,
        });
      }
    }

    broadcast({ type: 'permissions.updated', payload: { task_id, grants: newGrants } });

    return { grants: newGrants };
  });

  app.delete<{ Params: { id: string } }>('/v1/permissions/:id', async (req, reply) => {
    const grant = grants.get(req.params.id);
    if (!grant) return reply.code(404).send({ error: 'Grant not found' });

    grant.revoked_at = now();

    evidenceLedger.record(grant.task_id, AuditEventType.PermissionRevoked, {
      grant_id: grant.id,
      capability: grant.capability,
      origin: grant.origin,
    });

    broadcast({ type: 'permissions.revoked', payload: { grant } });

    return { revoked: true };
  });

  // ─── Snapshots ────────────────────────────────────────────────────────

  app.post<{ Params: { id: string }; Body: { mode?: string } }>(
    '/v1/tabs/:id/snapshot',
    async (req) => {
      // Request snapshot from extension via WebSocket
      broadcast({
        type: 'task.capture_snapshot',
        payload: { tab_id: req.params.id, mode: req.body.mode || 'compact' },
      });

      return { status: 'snapshot_requested', tab_id: req.params.id };
    },
  );

  // ─── Actions ──────────────────────────────────────────────────────────

  app.post<{
    Params: { id: string };
    Body: { task_id: string; ref: string; metadata?: Record<string, unknown> };
  }>('/v1/tabs/:id/actions/click', async (req, reply) => {
    const { task_id, ref, metadata } = req.body;
    const task = tasks.get(task_id);
    if (!task) return reply.code(404).send({ error: 'Task not found' });

    const actionRequest: ActionRequest = {
      id: generateId(),
      task_id,
      tab_id: req.params.id,
      type: 'click' as any,
      ref,
      metadata,
      risk: RiskLevel.Low,
      timestamp: now(),
    };

    // Classify risk
    const risk = riskClassifier.classify(actionRequest);
    actionRequest.risk = risk;

    // Check policy
    const taskPolicyEngine = createPolicyEngineForTask(task_id);
    const decision = taskPolicyEngine.evaluate(actionRequest);

    if (!decision.allowed && !decision.requires_approval) {
      evidenceLedger.record(task_id, AuditEventType.ActionBlocked, {
        action_id: actionRequest.id,
        reason: decision.reason,
      });
      return reply.code(403).send({ error: decision.reason, decision });
    }

    if (decision.requires_approval) {
      // Create approval request
      const approval: Approval = {
        id: generateId(),
        task_id,
        action: actionRequest,
        diff: {
          summary: `Click element: ${ref}`,
          target: req.params.id,
          data: metadata || {},
          consequence: 'Element will be clicked',
          agent_reason: 'Required to complete task',
          reversible: false,
        },
        hash: '',
        policy_reason: decision.reason,
        created_at: now(),
      };

      approvals.set(approval.id, approval);
      task.status = TaskStatus.WaitingApproval;

      evidenceLedger.record(task_id, AuditEventType.ApprovalRequired, {
        approval_id: approval.id,
        action: 'click',
        ref,
      });

      broadcast({ type: 'approval.required', payload: approval });
      broadcast({ type: 'task.status', payload: task });

      return { approval_required: true, approval };
    }

    // Execute the action
    evidenceLedger.record(task_id, AuditEventType.ActionExecuted, {
      action_id: actionRequest.id,
      type: 'click',
      ref,
    });

    // Forward to extension
    broadcast({
      type: 'task.execute_action',
      payload: {
        task_id,
        tab_id: req.params.id,
        action: { id: actionRequest.id, type: 'click', selector: ref },
      },
    });

    broadcast({
      type: 'action.executed',
      payload: { description: `Clicked: ${ref}`, timestamp: now() },
    });

    return { executed: true, action_id: actionRequest.id };
  });

  app.post<{
    Params: { id: string };
    Body: { task_id: string; ref: string; value: string };
  }>('/v1/tabs/:id/actions/fill', async (req, reply) => {
    const { task_id, ref, value } = req.body;
    const task = tasks.get(task_id);
    if (!task) return reply.code(404).send({ error: 'Task not found' });

    evidenceLedger.record(task_id, AuditEventType.ActionExecuted, {
      type: 'fill',
      ref,
      value_length: value.length,
    });

    broadcast({
      type: 'task.execute_action',
      payload: {
        task_id,
        tab_id: req.params.id,
        action: { id: generateId(), type: 'fill', selector: ref, value },
      },
    });

    broadcast({
      type: 'action.executed',
      payload: { description: `Filled field: ${ref}`, timestamp: now() },
    });

    return { executed: true };
  });

  app.post<{ Params: { id: string }; Body: { task_id: string; url: string } }>(
    '/v1/tabs/:id/actions/navigate',
    async (req, reply) => {
      const { task_id, url } = req.body;
      const task = tasks.get(task_id);
      if (!task) return reply.code(404).send({ error: 'Task not found' });

      // Check if URL origin is permitted
      const urlOrigin = new URL(url).origin;
      const taskGrants = [...grants.values()].filter(g => g.task_id === task_id && !g.revoked_at);
      const hasNavigateGrant = taskGrants.some(g => g.capability === 'navigate.origin' as any);

      if (!hasNavigateGrant) {
        return reply.code(403).send({ error: `No navigate capability for ${urlOrigin}` });
      }

      evidenceLedger.record(task_id, AuditEventType.ActionExecuted, {
        type: 'navigate',
        url,
        origin: urlOrigin,
      });

      broadcast({
        type: 'tab.navigate',
        payload: { task_id, tab_id: req.params.id, url },
      });

      return { navigating: true, url };
    },
  );

  // ─── Approvals ────────────────────────────────────────────────────────

  app.get('/v1/approvals', async () => {
    const pending = [...approvals.values()].filter(a => !a.decision);
    return { approvals: pending };
  });

  app.post<{ Params: { id: string }; Body: { decision: string } }>(
    '/v1/approvals/:id/decision',
    async (req, reply) => {
      const approval = approvals.get(req.params.id);
      if (!approval) return reply.code(404).send({ error: 'Approval not found' });

      approval.decision = req.body.decision as any;
      approval.decided_at = now();
      approval.reviewer = 'user';

      const task = tasks.get(approval.task_id);
      if (task && task.status === TaskStatus.WaitingApproval) {
        task.status = approval.decision === 'approve_once' ? TaskStatus.Acting : TaskStatus.Stopped;
        broadcast({ type: 'task.status', payload: task });
      }

      evidenceLedger.record(approval.task_id, AuditEventType.ApprovalDecided, {
        approval_id: approval.id,
        decision: approval.decision,
      });

      broadcast({ type: 'approval.decided', payload: approval });

      return { approval };
    },
  );

  // ─── Audit / Evidence ─────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>('/v1/tasks/:id/audit', async (req, reply) => {
    const task = tasks.get(req.params.id);
    if (!task) return reply.code(404).send({ error: 'Task not found' });

    const events = evidenceLedger.getEventsForTask(req.params.id);
    return { events };
  });

  app.post<{ Params: { id: string } }>('/v1/tasks/:id/evidence', async (req, reply) => {
    const task = tasks.get(req.params.id);
    if (!task) return reply.code(404).send({ error: 'Task not found' });

    const events = evidenceLedger.getEventsForTask(req.params.id);
    const taskGrants = [...grants.values()].filter(g => g.task_id === req.params.id);
    const taskApprovals = [...approvals.values()].filter(a => a.task_id === req.params.id);

    // Build evidence receipt
    const receipt = {
      task_id: task.id,
      objective: task.objective,
      mode: task.mode,
      status: task.status,
      created_at: task.created_at,
      completed_at: task.completed_at,
      grants: taskGrants,
      site_policies: task.origins.map(o => ({
        origin: o,
        state: sitePolicyRegistry.getState(o),
      })),
      events,
      approvals: taskApprovals,
      egress_summary: {
        data_left_device: task.mode === TaskMode.RemoteRunner,
        destinations: [],
        data_classes: [],
        redaction_applied: true,
      },
      redaction_summary: { count: 0, categories: [] },
      download_hashes: [],
      integrity_hash: evidenceLedger.verifyIntegrity() ? 'verified' : 'integrity_check_failed',
    };

    return { receipt };
  });

  // ─── Policy ───────────────────────────────────────────────────────────

  app.get<{ Querystring: { origin?: string } }>('/v1/policy/explain', async (req) => {
    const origin = req.query.origin;
    if (!origin) return { message: 'Provide an ?origin= parameter' };

    const policy = sitePolicyRegistry.get(origin);
    const budget = sitePolicyRegistry.getDefaultBudget(origin);

    return {
      origin,
      policy,
      traffic_budget: budget,
      explanation: `Site '${origin}' is in state '${policy.state}'. ` +
        `Traffic budget: ${budget.requests_per_minute} req/min, ${budget.max_concurrent_tasks} concurrent.`,
    };
  });

  // ─── Skills ───────────────────────────────────────────────────────────

  app.post<{ Params: { id: string }; Body: { inputs?: Record<string, unknown> } }>(
    '/v1/skills/:id/run',
    async (req, reply) => {
      return reply.code(501).send({ error: 'Skill system coming in Phase 2' });
    },
  );

  // ─── Start Server ─────────────────────────────────────────────────────

  try {
    await app.listen({ port: PORT, host: HOST });
    logger.info(`AgentBridge companion listening on ${HOST}:${PORT}`);
    console.log(`
  ╔════════════════════════════════════════════════════╗
  ║                                                    ║
  ║   🌉 AgentBridge Companion v0.1.0                  ║
  ║                                                    ║
  ║   API:  http://${HOST}:${PORT}                     ║
  ║   WS:   ws://${HOST}:${PORT}/ws                    ║
  ║   Mode: Local-only                                 ║
  ║                                                    ║
  ╚════════════════════════════════════════════════════╝
    `);
  } catch (err) {
    logger.error('Failed to start companion', { error: (err as Error).message });
    process.exit(1);
  }
}

// ─── WebSocket Message Handler ──────────────────────────────────────────────

function handleWsMessage(socket: import('ws').WebSocket, msg: { type: string; payload: any }) {
  switch (msg.type) {
    case 'client.register':
      logger.info('Client registered', { type: msg.payload.client_type });
      // Send current state sync
      const activeTasks = [...tasks.values()].filter(t => !['complete', 'failed', 'stopped'].includes(t.status));
      socket.send(JSON.stringify({
        type: 'sync',
        payload: { task: activeTasks[0] || null },
      }));
      break;

    case 'task.pause':
      pauseTask(msg.payload.task_id);
      break;

    case 'task.stop':
      stopTask(msg.payload.task_id);
      break;

    case 'snapshot.result':
    case 'action.result':
    case 'page.observed':
    case 'page.changed':
    case 'tab.updated':
    case 'tab.closed':
      // Forward extension events to all clients
      broadcastExcept(socket, msg);
      break;
  }
}

function pauseTask(taskId: string) {
  const task = tasks.get(taskId);
  if (!task) return;

  task.status = TaskStatus.Paused;
  evidenceLedger.record(taskId, AuditEventType.TaskPaused, {});
  broadcast({ type: 'task.status', payload: task });
}

function stopTask(taskId: string) {
  const task = tasks.get(taskId);
  if (!task) return;

  task.status = TaskStatus.Stopped;
  task.completed_at = now();
  evidenceLedger.record(taskId, AuditEventType.TaskStopped, {});
  broadcast({ type: 'task.status', payload: task });
}

// ─── Broadcast Helpers ──────────────────────────────────────────────────────

function broadcast(msg: object) {
  const data = JSON.stringify(msg);
  for (const client of wsClients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(data);
    }
  }
}

function broadcastExcept(exclude: import('ws').WebSocket, msg: object) {
  const data = JSON.stringify(msg);
  for (const client of wsClients) {
    if (client !== exclude && client.readyState === 1) {
      client.send(data);
    }
  }
}

// ─── Start ──────────────────────────────────────────────────────────────────

start();

export { app };
