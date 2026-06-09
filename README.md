# 🌉 AgentBridge

**The secure browser workspace for AI agents.**

Permission-first. Restriction-aware. Evidence by default.

AgentBridge lets users delegate bounded web tasks to AI agents while preserving control over identity, sessions, secrets, submissions, payments, and data egress.

## Architecture

```
agentbridge/
├── packages/
│   ├── core/          → Shared types, policy engine, evidence ledger, RCL
│   ├── companion/     → Local Node.js daemon + HTTP/WebSocket API
│   ├── extension/     → Chrome Manifest V3 browser extension
│   ├── sdk/           → TypeScript SDK for agent developers
│   └── cli/           → Command-line tool
```

## Quick Start

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Start the companion daemon
npm run dev:companion

# Run the doctor check
npx agentbridge doctor
```

## Packages

### @agentbridge/core
Shared foundation library — types, enums, policy engine, risk classifier, evidence ledger, restriction compliance layer, authentication.

### @agentbridge/companion
Local HTTP/WebSocket daemon running on `127.0.0.1:17352`. Serves all REST API endpoints, manages tasks, evaluates policies, and records evidence.

### @agentbridge/extension
Chrome extension (Manifest V3) with side panel UI, content scripts for page observation, snapshot engine, approval modals, and challenge pause screen.

### @agentbridge/sdk
TypeScript SDK for connecting AI agents to browser workspaces:

```ts
const bridge = await AgentBridge.connect();
const task = await bridge.tasks.create({
  objective: "Download latest invoice",
  mode: "local_attach",
  riskTolerance: "medium",
});

await task.permissions.request({
  origins: ["https://billing.example.com"],
  capabilities: ["navigate.origin", "read.visible_text", "action.click.low"],
  duration: "task",
});

const space = await task.spaces.create({ name: "invoice-download", ephemeral: true });
const receipt = await task.audit.exportEvidencePackage();
```

### @agentbridge/cli
Command-line tool for managing agent browser workspaces:

```bash
agentbridge doctor                          # Health check
agentbridge task create "Download invoice"  # Create task
agentbridge task status <id>                # Check status
agentbridge evidence <task-id>              # Export receipt
agentbridge policy explain https://example.com  # Policy info
```

## Principles

1. **Permission-first**: No implicit access. Every capability is explicitly granted.
2. **Restriction-aware**: Don't bypass CAPTCHAs, rate limits, or site policies.
3. **Evidence by default**: Tamper-evident audit trail for every action.
4. **Local-first**: Data stays on the user's device unless explicitly exported.
5. **API-first routing**: If an official API exists, use it before browser automation.

## License

MIT
