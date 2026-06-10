import React, { useState } from 'react';
import './InstallationGuide.css';

export const InstallationGuide: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'install' | 'usage'>('install');

  return (
    <div className="guide-container glass">
      <div className="guide-tabs">
        <button 
          className={`tab-btn ${activeTab === 'install' ? 'active' : ''}`}
          onClick={() => setActiveTab('install')}
        >
          <span className="tab-icon">⚙️</span>
          Installation & Setup
        </button>
        <button 
          className={`tab-btn ${activeTab === 'usage' ? 'active' : ''}`}
          onClick={() => setActiveTab('usage')}
        >
          <span className="tab-icon">🚀</span>
          Using the SDK
        </button>
      </div>

      <div className="guide-content">
        {activeTab === 'install' && (
          <div className="guide-step-list animate-fade-in">
            <div className="guide-step">
              <div className="step-number">1</div>
              <div className="step-details">
                <h3>Start the Local Companion Daemon</h3>
                <p>The companion daemon is the central orchestrator that manages policies and local security.</p>
                <div className="code-block">
                  <pre><code>npm install
npm run dev:companion</code></pre>
                </div>
                <p className="step-note">Must be running on <code>127.0.0.1:17352</code> for the extension to connect.</p>
              </div>
            </div>

            <div className="guide-step">
              <div className="step-number">2</div>
              <div className="step-details">
                <h3>Install the Browser Extension</h3>
                <p>The extension acts as the secure sandbox where the AI operates.</p>
                <ol className="step-list">
                  <li>Open Chrome and navigate to <code>chrome://extensions/</code></li>
                  <li>Enable <strong>Developer mode</strong> in the top right.</li>
                  <li>Click <strong>Load unpacked</strong> and select the <code>packages/extension</code> folder.</li>
                  <li>Pin the extension and click it to open the control panel.</li>
                </ol>
              </div>
            </div>

            <div className="guide-step">
              <div className="step-number">3</div>
              <div className="step-details">
                <h3>Verify System Health</h3>
                <p>Use the built-in CLI to ensure all components are communicating properly.</p>
                <div className="code-block">
                  <pre><code>npx agentbridge doctor</code></pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'usage' && (
          <div className="guide-step-list animate-fade-in">
            <div className="guide-step">
              <div className="step-number">1</div>
              <div className="step-details">
                <h3>Connect & Request Permissions</h3>
                <p>Your AI agent connects to the bridge and explicitly requests the capabilities it needs.</p>
                <div className="code-block">
                  <pre><code>{`import { AgentBridge } from '@agentbridge/sdk';

const bridge = await AgentBridge.connect();
const task = await bridge.tasks.create({ objective: "Download Invoice" });

await task.permissions.request({
  origins: ["https://billing.example.com"],
  capabilities: ["navigate.origin", "action.click.low"],
});`}</code></pre>
                </div>
              </div>
            </div>

            <div className="guide-step">
              <div className="step-number">2</div>
              <div className="step-details">
                <h3>Create a Space & Execute</h3>
                <p>The agent creates an isolated browser tab and executes its logic based on redacted snapshots.</p>
                <div className="code-block">
                  <pre><code>{`const space = await task.spaces.create({ name: "invoice-download" });
const tab = await space.openTab("https://billing.example.com");

const snap = await tab.snapshot({ mode: "compact" });
await tab.click(snap.refByText("Download Invoice"));`}</code></pre>
                </div>
              </div>
            </div>

            <div className="guide-step">
              <div className="step-number">3</div>
              <div className="step-details">
                <h3>Export Evidence</h3>
                <p>Once the task is complete, export the cryptographically signed evidence ledger.</p>
                <div className="code-block">
                  <pre><code>{`const receipt = await task.audit.exportEvidencePackage();
console.log(receipt.integrity_hash);`}</code></pre>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
