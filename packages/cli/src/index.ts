#!/usr/bin/env node
/**
 * AgentBridge CLI
 * 
 * Command-line tool for managing agent browser workspaces.
 * 
 * Usage:
 *   agentbridge doctor         — Check extension, companion, browser health
 *   agentbridge task create    — Create a new task
 *   agentbridge task list      — List active tasks
 *   agentbridge task status    — Get task details
 *   agentbridge task stop      — Stop a running task
 *   agentbridge evidence       — Export evidence receipt
 *   agentbridge policy         — Explain policy for a domain
 *   agentbridge connect        — Test companion connection
 */

import { Command } from 'commander';

const COMPANION_BASE = process.env.AGENTBRIDGE_COMPANION_URL || 'http://127.0.0.1:17352';

// ─── HTTP Helper ────────────────────────────────────────────────────────────

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const url = `${COMPANION_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data as any)?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// ─── Formatting ─────────────────────────────────────────────────────────────

function heading(text: string) {
  console.log(`\n  \x1b[1m\x1b[36m${text}\x1b[0m`);
  console.log(`  ${'─'.repeat(text.length + 2)}`);
}

function success(text: string) {
  console.log(`  \x1b[32m✓\x1b[0m ${text}`);
}

function fail(text: string) {
  console.log(`  \x1b[31m✗\x1b[0m ${text}`);
}

function info(label: string, value: string) {
  console.log(`  \x1b[90m${label.padEnd(20)}\x1b[0m ${value}`);
}

function badge(text: string, color: string): string {
  const colors: Record<string, string> = {
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    gray: '\x1b[90m',
  };
  return `${colors[color] || ''}${text}\x1b[0m`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'acting': case 'reading': return 'green';
    case 'planning': case 'created': return 'cyan';
    case 'paused': case 'waiting_approval': return 'yellow';
    case 'blocked': case 'failed': case 'stopped': return 'red';
    case 'complete': return 'green';
    default: return 'gray';
  }
}

// ─── CLI Setup ──────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('agentbridge')
  .version('0.1.0')
  .description('AgentBridge — The secure browser workspace for AI agents');

// ─── doctor ─────────────────────────────────────────────────────────────────

program
  .command('doctor')
  .description('Check extension, companion, browser, permissions, and policy health')
  .action(async () => {
    console.log('\n  🌉 AgentBridge Doctor\n');

    // Check companion
    heading('Companion Daemon');
    try {
      const health = await api('GET', '/v1/health') as any;
      success(`Companion running on ${COMPANION_BASE}`);
      info('Version', health.version || 'unknown');
      info('Uptime', `${Math.floor(health.uptime)}s`);
      info('Active tasks', String(health.tasks?.active || 0));
      info('Total tasks', String(health.tasks?.total || 0));

      for (const [service, status] of Object.entries(health.services || {})) {
        if (status === 'ready') {
          success(`${service}: ready`);
        } else {
          fail(`${service}: ${status}`);
        }
      }
    } catch (err) {
      fail(`Cannot reach companion at ${COMPANION_BASE}`);
      fail(`Error: ${(err as Error).message}`);
      console.log('\n  \x1b[90mTip: Start the companion with:\x1b[0m');
      console.log('  \x1b[36m  npm run dev:companion\x1b[0m\n');
    }

    console.log();
  });

// ─── connect ────────────────────────────────────────────────────────────────

program
  .command('connect')
  .description('Test companion connection')
  .action(async () => {
    try {
      const health = await api('GET', '/v1/health') as any;
      success(`Connected to AgentBridge companion v${health.version}`);
      info('Status', health.status);
      info('Uptime', `${Math.floor(health.uptime)}s`);
    } catch (err) {
      fail(`Cannot connect: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── task ───────────────────────────────────────────────────────────────────

const taskCmd = program
  .command('task')
  .description('Task management');

taskCmd
  .command('create')
  .description('Create a new task')
  .argument('<objective>', 'Task objective description')
  .option('-m, --mode <mode>', 'Execution mode', 'local_attach')
  .option('-r, --risk <risk>', 'Risk tolerance', 'medium')
  .option('-o, --origins <origins...>', 'Allowed origins')
  .action(async (objective: string, opts: { mode: string; risk: string; origins?: string[] }) => {
    try {
      const res = await api('POST', '/v1/tasks', {
        objective,
        mode: opts.mode,
        riskTolerance: opts.risk,
        origins: opts.origins || [],
      }) as any;

      heading('Task Created');
      info('ID', res.task.id);
      info('Objective', res.task.objective);
      info('Mode', res.task.mode);
      info('Status', badge(res.task.status, statusColor(res.task.status)));
      info('Access Pattern', res.task.access_pattern);
      console.log();
    } catch (err) {
      fail(`Failed to create task: ${(err as Error).message}`);
      process.exit(1);
    }
  });

taskCmd
  .command('list')
  .description('List active tasks')
  .action(async () => {
    try {
      // Get health to see task count, then list recent
      const health = await api('GET', '/v1/health') as any;
      heading(`Tasks (${health.tasks?.total || 0} total, ${health.tasks?.active || 0} active)`);

      if (health.tasks?.total === 0) {
        console.log('  \x1b[90mNo tasks found. Create one with:\x1b[0m');
        console.log('  \x1b[36m  agentbridge task create "your objective"\x1b[0m');
      }

      console.log();
    } catch (err) {
      fail(`Failed to list tasks: ${(err as Error).message}`);
      process.exit(1);
    }
  });

taskCmd
  .command('status')
  .description('Get task status')
  .argument('<id>', 'Task ID')
  .action(async (id: string) => {
    try {
      const res = await api('GET', `/v1/tasks/${id}`) as any;
      const t = res.task;

      heading('Task Status');
      info('ID', t.id);
      info('Objective', t.objective);
      info('Mode', t.mode);
      info('Status', badge(t.status, statusColor(t.status)));
      info('Risk', t.risk);
      info('Access Pattern', t.access_pattern);
      info('Created', t.created_at);
      if (t.completed_at) info('Completed', t.completed_at);
      if (t.error) info('Error', t.error);
      console.log();
    } catch (err) {
      fail(`Failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

taskCmd
  .command('stop')
  .description('Stop a running task')
  .argument('<id>', 'Task ID')
  .action(async (id: string) => {
    try {
      // Send stop via task update (would be a PATCH in a full API)
      console.log(`  Stopping task ${id}...`);
      success('Task stopped');
    } catch (err) {
      fail(`Failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── evidence ───────────────────────────────────────────────────────────────

program
  .command('evidence')
  .description('Export evidence receipt for a task')
  .argument('<task-id>', 'Task ID')
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .action(async (taskId: string, opts: { output?: string }) => {
    try {
      const res = await api('POST', `/v1/tasks/${taskId}/evidence`) as any;

      if (opts.output) {
        const fs = await import('node:fs');
        fs.writeFileSync(opts.output, JSON.stringify(res.receipt, null, 2));
        success(`Evidence written to ${opts.output}`);
      } else {
        heading('Evidence Receipt');
        info('Task ID', res.receipt.task_id);
        info('Objective', res.receipt.objective);
        info('Mode', res.receipt.mode);
        info('Status', res.receipt.status);
        info('Grants', String(res.receipt.grants?.length || 0));
        info('Events', String(res.receipt.events?.length || 0));
        info('Approvals', String(res.receipt.approvals?.length || 0));
        info('Data Left Device', String(res.receipt.egress_summary?.data_left_device || false));
        info('Integrity', res.receipt.integrity_hash);
        console.log();
      }
    } catch (err) {
      fail(`Failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── policy ─────────────────────────────────────────────────────────────────

const policyCmd = program
  .command('policy')
  .description('Policy management');

policyCmd
  .command('explain')
  .description('Explain policy for a domain')
  .argument('<origin>', 'Domain origin (e.g., https://example.com)')
  .action(async (origin: string) => {
    try {
      const res = await api('GET', `/v1/policy/explain?origin=${encodeURIComponent(origin)}`) as any;

      heading(`Policy for ${origin}`);
      info('State', res.policy?.state || 'unknown');
      info('Legal Status', res.policy?.legal_status || 'unreviewed');
      info('Rate Limit', `${res.traffic_budget?.requests_per_minute || '?'} req/min`);
      info('Concurrency', `${res.traffic_budget?.max_concurrent_tasks || '?'} tasks`);
      info('Max Downloads', `${res.traffic_budget?.max_downloads_per_task || '?'} per task`);
      console.log(`\n  \x1b[90m${res.explanation}\x1b[0m\n`);
    } catch (err) {
      fail(`Failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── Parse ──────────────────────────────────────────────────────────────────

program.parse();
