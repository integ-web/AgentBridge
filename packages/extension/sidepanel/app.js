/**
 * AgentBridge Side Panel Application
 * 
 * Manages the side panel UI state, connects to the companion daemon
 * via WebSocket, and renders real-time task updates.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const COMPANION_WS_URL = 'ws://127.0.0.1:17352/ws';
const RECONNECT_DELAY_MS = 3000;
const MAX_FEED_ITEMS = 50;

// ─── DOM Refs ───────────────────────────────────────────────────────────────

const els = {
  connectionBar: document.getElementById('connection-bar'),
  connectionText: document.querySelector('.connection-text'),
  emptyState: document.getElementById('empty-state'),
  taskActive: document.getElementById('task-active'),
  taskTitle: document.getElementById('task-title'),
  taskMode: document.getElementById('task-mode'),
  taskStatus: document.getElementById('task-status'),
  agentName: document.getElementById('agent-name'),
  agentProvider: document.getElementById('agent-provider'),
  originText: document.getElementById('origin-text'),
  permissionChips: document.getElementById('permission-chips'),
  riskBar: document.getElementById('risk-bar'),
  trafficState: document.getElementById('traffic-state'),
  dataStateBar: document.getElementById('data-state-bar'),
  sectionFeed: document.getElementById('section-feed'),
  feedList: document.getElementById('feed-list'),
  footerBar: document.getElementById('footer-bar'),
  btnNewTask: document.getElementById('btn-new-task'),
  btnPause: document.getElementById('btn-pause'),
  btnStop: document.getElementById('btn-stop'),
  btnReceipt: document.getElementById('btn-receipt'),
  btnTimeline: document.getElementById('btn-timeline'),
};

// ─── State ──────────────────────────────────────────────────────────────────

let ws = null;
let reconnectTimer = null;
let currentTask = null;

// ─── Mode Labels ────────────────────────────────────────────────────────────

const MODE_LABELS = {
  local_attach: 'Local Attach',
  bundled_hardened: 'Bundled Hardened',
  remote_runner: 'Remote Runner',
};

const STATUS_LABELS = {
  created: 'Created',
  planning: 'Planning',
  reading: 'Reading',
  acting: 'Acting',
  paused: 'Paused',
  waiting_approval: 'Awaiting Approval',
  blocked: 'Blocked',
  complete: 'Complete',
  failed: 'Failed',
  stopped: 'Stopped',
};

const CAPABILITY_LABELS = {
  'navigate.origin': 'Navigate',
  'read.visible_text': 'Read text',
  'read.screenshot': 'Screenshot',
  'read.form_values': 'Form values',
  'action.click.low': 'Click',
  'action.fill': 'Fill',
  'action.submit': 'Submit',
  'file.download': 'Download',
  'file.upload': 'Upload',
  'session.reuse': 'Session',
  'model.egress.page': 'Model egress',
  'secret.use': 'Secret',
  'dev.console': 'Console',
  'dev.network': 'Network',
};

const RISK_LABELS = {
  low: { label: 'Low Risk', className: 'risk-low' },
  medium: { label: 'Medium Risk', className: 'risk-medium' },
  high: { label: 'High Risk', className: 'risk-high' },
  critical: { label: 'Critical Risk', className: 'risk-critical' },
  prohibited: { label: 'Prohibited', className: 'risk-prohibited' },
};

// ─── WebSocket Connection ───────────────────────────────────────────────────

function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  setConnectionState('connecting');

  try {
    ws = new WebSocket(COMPANION_WS_URL);

    ws.addEventListener('open', () => {
      setConnectionState('connected');
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      // Request current state
      ws.send(JSON.stringify({ type: 'sync', payload: {} }));
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch {
        console.warn('[AgentBridge] Failed to parse WS message');
      }
    });

    ws.addEventListener('close', () => {
      setConnectionState('disconnected');
      scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      setConnectionState('disconnected');
    });
  } catch {
    setConnectionState('disconnected');
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY_MS);
}

function setConnectionState(state) {
  const bar = els.connectionBar;
  bar.className = `connection-bar ${state}`;

  switch (state) {
    case 'connecting':
      els.connectionText.textContent = 'Connecting to companion...';
      break;
    case 'connected':
      els.connectionText.textContent = 'Connected to companion';
      break;
    case 'disconnected':
      els.connectionText.textContent = 'Disconnected — retrying...';
      break;
  }
}

// ─── Message Handling ───────────────────────────────────────────────────────

function handleMessage(msg) {
  switch (msg.type) {
    case 'task.status':
      updateTask(msg.payload);
      break;
    case 'action.executed':
      addFeedItem('action', msg.payload.description || 'Action executed', msg.payload.timestamp);
      break;
    case 'approval.required':
      addFeedItem('approval', `Approval needed: ${msg.payload.summary}`, msg.payload.timestamp);
      break;
    case 'challenge.detected':
      addFeedItem('block', `Human verification required (${msg.payload.type})`, msg.payload.timestamp);
      break;
    case 'policy.block':
      addFeedItem('block', `Blocked: ${msg.payload.reason}`, msg.payload.timestamp);
      break;
    case 'snapshot.captured':
      addFeedItem('read', `Page captured: ${msg.payload.title || msg.payload.url}`, msg.payload.timestamp);
      break;
    case 'sync':
      if (msg.payload.task) {
        updateTask(msg.payload.task);
      }
      break;
  }
}

// ─── UI Updates ─────────────────────────────────────────────────────────────

function updateTask(task) {
  currentTask = task;

  if (!task) {
    els.emptyState.style.display = '';
    els.taskActive.style.display = 'none';
    els.sectionFeed.style.display = 'none';
    els.footerBar.style.display = 'none';
    return;
  }

  els.emptyState.style.display = 'none';
  els.taskActive.style.display = '';
  els.sectionFeed.style.display = '';
  els.footerBar.style.display = '';

  // Task header
  els.taskTitle.textContent = task.objective || '—';
  els.taskMode.textContent = MODE_LABELS[task.mode] || task.mode;
  els.taskStatus.textContent = STATUS_LABELS[task.status] || task.status;
  els.taskStatus.dataset.status = task.status;

  // Agent
  if (task.agent) {
    els.agentName.textContent = task.agent.name || '—';
    els.agentProvider.textContent = task.agent.provider || '—';
  }

  // Origin
  els.originText.textContent = task.origins?.join(', ') || '—';

  // Permissions
  updatePermissions(task.granted_capabilities || [], task.blocked_capabilities || []);

  // Risk
  updateRisk(task.risk || 'low');

  // Data state
  const isLocal = task.mode === 'local_attach' || task.mode === 'bundled_hardened';
  els.dataStateBar.querySelector('span').textContent = isLocal
    ? 'Local only — no data leaves device'
    : 'Remote runner — egress receipt required';
}

function updatePermissions(granted, blocked) {
  els.permissionChips.innerHTML = '';

  for (const cap of granted) {
    const chip = document.createElement('span');
    chip.className = 'chip chip-granted';
    chip.textContent = CAPABILITY_LABELS[cap] || cap;
    els.permissionChips.appendChild(chip);
  }

  for (const cap of blocked) {
    const chip = document.createElement('span');
    chip.className = 'chip chip-blocked';
    chip.textContent = CAPABILITY_LABELS[cap] || cap;
    els.permissionChips.appendChild(chip);
  }
}

function updateRisk(level) {
  const riskInfo = RISK_LABELS[level] || RISK_LABELS.low;
  const indicator = els.riskBar.querySelector('.risk-indicator');
  indicator.className = `risk-indicator ${riskInfo.className}`;
  indicator.querySelector('span').textContent = riskInfo.label;
}

function addFeedItem(type, text, timestamp) {
  const item = document.createElement('div');
  item.className = 'feed-item';

  const dotClass = {
    action: 'feed-dot-action',
    read: 'feed-dot-read',
    approval: 'feed-dot-approval',
    block: 'feed-dot-block',
    complete: 'feed-dot-complete',
  }[type] || 'feed-dot-action';

  const time = timestamp
    ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  item.innerHTML = `
    <div class="feed-dot ${dotClass}"></div>
    <div class="feed-content">
      <div class="feed-text">${escapeHtml(text)}</div>
      <div class="feed-time">${time}</div>
    </div>
  `;

  els.feedList.prepend(item);

  // Limit feed size
  while (els.feedList.children.length > MAX_FEED_ITEMS) {
    els.feedList.removeChild(els.feedList.lastChild);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ─── Button Handlers ────────────────────────────────────────────────────────

els.btnNewTask?.addEventListener('click', () => {
  // In a real implementation, this opens the task composer
  // For now, we send a message to the companion
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ui.new_task', payload: {} }));
  }
});

els.btnPause?.addEventListener('click', () => {
  if (ws?.readyState === WebSocket.OPEN && currentTask) {
    ws.send(JSON.stringify({
      type: 'task.pause',
      payload: { task_id: currentTask.id },
    }));
  }
});

els.btnStop?.addEventListener('click', () => {
  if (ws?.readyState === WebSocket.OPEN && currentTask) {
    ws.send(JSON.stringify({
      type: 'task.stop',
      payload: { task_id: currentTask.id },
    }));
  }
});

// ─── Init ───────────────────────────────────────────────────────────────────

connect();
