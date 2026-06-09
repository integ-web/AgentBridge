# Welcome to AgentBridge 🌉

AgentBridge is the secure browser workspace for AI agents. It acts as a protective layer between AI agents and the web, ensuring that agents only take actions you explicitly approve, while automatically generating a tamper-evident audit trail of everything they do.

This guide will walk you through setting up AgentBridge and running your first agent task.

## 1. Installation & Setup

AgentBridge consists of two main parts: the **Companion Daemon** (which runs locally on your machine) and the **Browser Extension**.

### Prerequisites
- Node.js (v18+)
- Google Chrome (or a Chromium-based browser)

### Starting the Companion Daemon
The companion daemon is the central orchestrator. It manages tasks, evaluates policies, and handles communication.

1. Open your terminal in the AgentBridge directory.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the companion server:
   ```bash
   npm run dev:companion
   ```
   *You should see a message saying "AgentBridge Companion v0.1.0 listening on 127.0.0.1:17352". Leave this terminal running.*

### Installing the Browser Extension
1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top right).
3. Click **Load unpacked** and select the `packages/extension` folder inside your AgentBridge project.
4. Pin the AgentBridge extension to your browser toolbar for easy access.
5. Click the extension icon to open the AgentBridge side panel. It will automatically connect to your running companion daemon.

## 2. Checking System Health

You can verify that everything is running correctly using the AgentBridge CLI.

Open a new terminal window and run:
```bash
npx agentbridge doctor
```
This will check the companion daemon, active tasks, and service health.

## 3. How to Use AgentBridge

AgentBridge is designed to be used via its TypeScript SDK by an AI agent, but you can understand the flow by seeing how a task is created and executed.

### The Agent Workflow

When an AI agent uses AgentBridge, it follows this secure flow:

1. **Connect & Create Task**: The agent connects to the local companion and defines its objective.
   ```typescript
   const bridge = await AgentBridge.connect();
   const task = await bridge.tasks.create({
     objective: "Download the latest invoice from billing.example.com",
     mode: "local_attach",
     riskTolerance: "medium"
   });
   ```

2. **Request Permissions**: The agent **cannot do anything** until it requests and is granted specific capabilities for specific domains.
   ```typescript
   await task.permissions.request({
     origins: ["https://billing.example.com"],
     capabilities: ["navigate.origin", "read.visible_text", "action.click.low"],
     duration: "task"
   });
   ```
   *Note: In the UI, you will see a prompt to approve these permissions.*

3. **Create a Space & Navigate**: The agent opens an isolated browser tab (a "Space") and navigates to the target URL.
   ```typescript
   const space = await task.spaces.create({ name: "invoice-download", ephemeral: true });
   const tab = await space.openTab("https://billing.example.com");
   ```

4. **Observe & Act**: The agent requests a snapshot of the page (which filters out sensitive data) and issues action commands (like click or fill).
   ```typescript
   const snap = await tab.snapshot({ mode: "compact" });
   
   // The agent finds the download button and clicks it
   await tab.click(snap.refByText("Download Invoice"));
   ```

5. **Human Approval for High-Risk Actions**: If the agent tries to do something risky (like submit a payment or delete an account), AgentBridge intercepts the action and shows you a **High-Risk Approval Modal**. You review the exact changes and click "Approve" or "Deny".

6. **Audit & Evidence**: Once the task is complete, a cryptographically secure receipt is generated.
   ```typescript
   const receipt = await task.audit.exportEvidencePackage();
   ```

## 4. Testing Your Setup

To see AgentBridge in action without writing a full AI agent, you can use the CLI to manually create and manage a task:

1. **Create a task:**
   ```bash
   npx agentbridge task create "Navigate to example.com" -o https://example.com
   ```
2. **List active tasks:**
   ```bash
   npx agentbridge task list
   ```
3. **Check task status:**
   ```bash
   npx agentbridge task status <your-task-id>
   ```
4. **Export the evidence receipt:**
   ```bash
   npx agentbridge evidence <your-task-id>
   ```

## 5. Security Principles to Remember

- **Never bypass challenges:** AgentBridge will automatically pause if it detects a CAPTCHA or MFA prompt. You must complete it manually.
- **Redaction is automatic:** Passwords, API keys, and credit cards are scrubbed before the agent sees the page.
- **You are in control:** You can click the **Stop Task** button in the extension at any time to instantly halt the agent.

---
*Ready to build? Check out the SDK documentation in the `@agentbridge/sdk` package to start connecting your agents!*
