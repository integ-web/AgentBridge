/**
 * AgentBridge Extension Service Worker
 * 
 * Background script that:
 * - Maintains WebSocket connection to the local companion daemon
 * - Routes messages between companion, content scripts, and side panel
 * - Manages tab associations with Spaces
 * - Handles permission requests for host access
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const COMPANION_PORT = 17352;
const COMPANION_WS_URL = `ws://127.0.0.1:${COMPANION_PORT}/ws`;
const COMPANION_HTTP_URL = `http://127.0.0.1:${COMPANION_PORT}`;
const RECONNECT_DELAY_MS = 3000;
const HEALTH_CHECK_INTERVAL_MS = 30000;

// ─── State ──────────────────────────────────────────────────────────────────

/** @type {WebSocket | null} */
let companionWs = null;
let reconnectTimer = null;
let healthCheckTimer = null;
let isConnected = false;

/** Map of tab ID → Space ID */
const tabSpaceMap = new Map();

/** Map of tab ID → task ID */
const tabTaskMap = new Map();

/** Active side panel ports */
const sidePanelPorts = new Set();

// ─── Side Panel Setup ───────────────────────────────────────────────────────

// Open side panel on extension icon click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ─── Companion Connection ───────────────────────────────────────────────────

async function connectToCompanion() {
  if (companionWs && (companionWs.readyState === WebSocket.CONNECTING || companionWs.readyState === WebSocket.OPEN)) {
    return;
  }

  try {
    companionWs = new WebSocket(COMPANION_WS_URL);

    companionWs.addEventListener('open', () => {
      console.log('[AgentBridge] Connected to companion');
      isConnected = true;
      broadcastToSidePanel({ type: 'connection.status', payload: { connected: true } });

      // Register as extension client
      companionWs.send(JSON.stringify({
        type: 'client.register',
        payload: {
          client_type: 'extension',
          client_id: chrome.runtime.id,
          version: chrome.runtime.getManifest().version,
        },
      }));

      startHealthCheck();
    });

    companionWs.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleCompanionMessage(msg);
      } catch (err) {
        console.warn('[AgentBridge] Failed to parse companion message:', err);
      }
    });

    companionWs.addEventListener('close', () => {
      console.log('[AgentBridge] Disconnected from companion');
      isConnected = false;
      companionWs = null;
      broadcastToSidePanel({ type: 'connection.status', payload: { connected: false } });
      stopHealthCheck();
      scheduleReconnect();
    });

    companionWs.addEventListener('error', (err) => {
      console.warn('[AgentBridge] Companion WS error:', err);
    });
  } catch (err) {
    console.warn('[AgentBridge] Failed to connect:', err);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToCompanion();
  }, RECONNECT_DELAY_MS);
}

function startHealthCheck() {
  stopHealthCheck();
  healthCheckTimer = setInterval(async () => {
    try {
      const res = await fetch(`${COMPANION_HTTP_URL}/v1/health`);
      if (!res.ok) {
        console.warn('[AgentBridge] Health check failed:', res.status);
      }
    } catch {
      console.warn('[AgentBridge] Health check failed — companion unreachable');
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

function stopHealthCheck() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

function sendToCompanion(msg) {
  if (companionWs?.readyState === WebSocket.OPEN) {
    companionWs.send(JSON.stringify(msg));
  }
}

// ─── Message Routing ────────────────────────────────────────────────────────

function handleCompanionMessage(msg) {
  // Forward all messages to side panel
  broadcastToSidePanel(msg);

  switch (msg.type) {
    case 'task.execute_action':
      // Companion asks us to execute an action in a tab
      executeActionInTab(msg.payload);
      break;

    case 'task.capture_snapshot':
      // Companion asks us to capture a snapshot of a tab
      captureSnapshot(msg.payload);
      break;

    case 'tab.navigate':
      // Navigate a tab to a URL
      navigateTab(msg.payload);
      break;

    case 'tab.associate':
      // Associate a tab with a Space/Task
      if (msg.payload.tab_id && msg.payload.space_id) {
        tabSpaceMap.set(msg.payload.tab_id, msg.payload.space_id);
      }
      if (msg.payload.tab_id && msg.payload.task_id) {
        tabTaskMap.set(msg.payload.tab_id, msg.payload.task_id);
      }
      break;
  }
}

function broadcastToSidePanel(msg) {
  // Use chrome.runtime messaging to reach side panel
  chrome.runtime.sendMessage(msg).catch(() => {
    // Side panel may not be open — ignore
  });
}

// ─── Tab Actions ────────────────────────────────────────────────────────────

async function executeActionInTab(payload) {
  const { tab_id, action } = payload;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab_id },
      func: executeAction,
      args: [action],
    });

    sendToCompanion({
      type: 'action.result',
      payload: {
        task_id: payload.task_id,
        action_id: action.id,
        success: true,
        result: results[0]?.result,
      },
    });
  } catch (err) {
    sendToCompanion({
      type: 'action.result',
      payload: {
        task_id: payload.task_id,
        action_id: action.id,
        success: false,
        error: err.message,
      },
    });
  }
}

// This function runs in the content script context
function executeAction(action) {
  switch (action.type) {
    case 'click': {
      const el = document.querySelector(action.selector);
      if (el) { el.click(); return { success: true }; }
      return { success: false, error: 'Element not found' };
    }
    case 'fill': {
      const el = document.querySelector(action.selector);
      if (el) {
        el.value = action.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true };
      }
      return { success: false, error: 'Element not found' };
    }
    case 'scroll': {
      window.scrollBy(0, action.amount || 500);
      return { success: true };
    }
    default:
      return { success: false, error: `Unknown action type: ${action.type}` };
  }
}

async function captureSnapshot(payload) {
  const { tab_id, task_id } = payload;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab_id },
      func: buildSnapshot,
    });

    const snapshot = results[0]?.result;
    if (snapshot) {
      sendToCompanion({
        type: 'snapshot.result',
        payload: { task_id, tab_id, snapshot },
      });
    }
  } catch (err) {
    sendToCompanion({
      type: 'snapshot.error',
      payload: { task_id, tab_id, error: err.message },
    });
  }
}

// This function runs in the content script context to build a snapshot
function buildSnapshot() {
  /** Build accessibility-like snapshot of the page */
  const snapshot = {
    url: location.href,
    title: document.title,
    timestamp: new Date().toISOString(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    scroll: {
      x: window.scrollX,
      y: window.scrollY,
      max_x: document.documentElement.scrollWidth - window.innerWidth,
      max_y: document.documentElement.scrollHeight - window.innerHeight,
    },
    refs: [],
    forms: [],
    warnings: [],
  };

  // Collect interactive elements as refs
  const interactiveSelectors = 'a, button, input, textarea, select, [role="button"], [role="link"], [role="tab"], [onclick]';
  const elements = document.querySelectorAll(interactiveSelectors);

  let refIndex = 0;
  for (const el of elements) {
    if (refIndex >= 200) break; // Cap refs

    const rect = el.getBoundingClientRect();
    const isVisible = rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';

    if (!isVisible) continue;

    const ref = {
      ref: `ref_${refIndex++}`,
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      name: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 80) || '',
      visible: true,
      actionable: !el.disabled,
      selector: generateSelector(el),
    };

    // Determine risk for the element
    const text = (ref.name + ' ' + (el.getAttribute('type') || '')).toLowerCase();
    if (/submit|pay|purchase|buy|delete|remove|send|publish|transfer/i.test(text)) {
      ref.risk = 'high';
    } else if (/login|password|signin|signup/i.test(text)) {
      ref.risk = 'critical';
    } else {
      ref.risk = 'low';
    }

    snapshot.refs.push(ref);
  }

  // Collect forms
  for (const form of document.forms) {
    const formInfo = {
      action: form.action,
      method: form.method,
      fields: [],
    };

    for (const field of form.elements) {
      if (field.tagName === 'FIELDSET') continue;
      formInfo.fields.push({
        name: field.name || field.id,
        type: field.type || 'text',
        label: field.labels?.[0]?.textContent?.trim() || '',
        required: field.required,
        redacted: field.type === 'password',
      });
    }

    snapshot.forms.push(formInfo);
  }

  // Check for challenge indicators
  const bodyText = document.body?.innerText?.toLowerCase() || '';
  if (/captcha|recaptcha|hcaptcha|verify you.re human|i.m not a robot/i.test(bodyText)) {
    snapshot.warnings.push({ type: 'captcha_detected', message: 'CAPTCHA or human verification detected on page' });
  }
  if (/two.factor|2fa|verification code|authenticator/i.test(bodyText)) {
    snapshot.warnings.push({ type: 'mfa_detected', message: 'Multi-factor authentication detected on page' });
  }

  return snapshot;
}

function generateSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
  if (el.getAttribute('aria-label')) return `[aria-label="${CSS.escape(el.getAttribute('aria-label'))}"]`;

  // Fallback: tag + classes
  let selector = el.tagName.toLowerCase();
  if (el.className && typeof el.className === 'string') {
    const classes = el.className.trim().split(/\s+/).slice(0, 2);
    selector += classes.map(c => `.${CSS.escape(c)}`).join('');
  }
  return selector;
}

async function navigateTab(payload) {
  const { tab_id, url } = payload;
  try {
    await chrome.tabs.update(tab_id, { url });
    sendToCompanion({
      type: 'tab.navigated',
      payload: { tab_id, url, success: true },
    });
  } catch (err) {
    sendToCompanion({
      type: 'tab.navigated',
      payload: { tab_id, url, success: false, error: err.message },
    });
  }
}

// ─── Message Listener (from side panel and content scripts) ─────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Forward to companion
  if (message.type?.startsWith('ui.') || message.type?.startsWith('task.')) {
    sendToCompanion(message);
  }
  sendResponse({ received: true });
  return true;
});

// ─── Tab Lifecycle ──────────────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  const spaceId = tabSpaceMap.get(tabId);
  const taskId = tabTaskMap.get(tabId);

  if (spaceId || taskId) {
    sendToCompanion({
      type: 'tab.closed',
      payload: { tab_id: tabId, space_id: spaceId, task_id: taskId },
    });
  }

  tabSpaceMap.delete(tabId);
  tabTaskMap.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tabTaskMap.has(tabId)) {
    sendToCompanion({
      type: 'tab.updated',
      payload: {
        tab_id: tabId,
        task_id: tabTaskMap.get(tabId),
        url: tab.url,
        title: tab.title,
      },
    });
  }
});

// ─── Init ───────────────────────────────────────────────────────────────────

connectToCompanion();
console.log('[AgentBridge] Service worker initialized');
