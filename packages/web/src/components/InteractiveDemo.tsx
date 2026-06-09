import { useState } from 'react';
import './InteractiveDemo.css';

type Step = 'idle' | 'planning' | 'requesting' | 'waiting' | 'acting' | 'done';

export const InteractiveDemo: React.FC = () => {
  const [step, setStep] = useState<Step>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  
  const addLog = (msg: string) => setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const startDemo = () => {
    setStep('planning');
    setLogs([]);
    addLog('Agent connected to Bridge');
    addLog('Task created: "Download June Invoice"');
    
    setTimeout(() => {
      setStep('requesting');
      addLog('Agent requesting capabilities...');
    }, 1500);
  };

  const approvePermissions = () => {
    setStep('acting');
    addLog('User approved permissions.');
    addLog('Executing task in isolated Space...');
    
    setTimeout(() => {
      setStep('waiting');
      addLog('Agent intercepted: High risk action detected (Submit Payment).');
    }, 2000);
  };

  const approveAction = () => {
    setStep('done');
    addLog('User approved high-risk action.');
    addLog('Task completed successfully.');
    addLog('Cryptographic evidence receipt generated.');
  };

  const denyAction = () => {
    setStep('done');
    addLog('User denied action.');
    addLog('Task stopped. Evidence ledger sealed.');
  }

  return (
    <div className="demo-container glass">
      {/* Agent Side */}
      <div className="demo-panel agent-panel">
        <div className="panel-header">
          <span className="dot bg-purple"></span>
          <h3>AI Agent SDK</h3>
        </div>
        <div className="panel-body console">
          <div className="code-line">
            <span className="keyword">const</span> bridge = <span className="keyword">await</span> AgentBridge.connect();
          </div>
          <div className="code-line">
            <span className="keyword">const</span> task = <span className="keyword">await</span> bridge.tasks.create({'{'}
          </div>
          <div className="code-line indent">objective: <span className="string">"Download June Invoice"</span></div>
          <div className="code-line">{'}'});</div>
          
          {step === 'idle' && (
            <button className="btn btn-primary mt-4" onClick={startDemo}>Run Script</button>
          )}

          {step !== 'idle' && (
            <>
              <div className="code-line mt-4">
                <span className="keyword">await</span> task.permissions.request({'{'}
              </div>
              <div className="code-line indent">origins: [<span className="string">"https://billing.com"</span>],</div>
              <div className="code-line indent">capabilities: [<span className="string">"navigate"</span>, <span className="string">"click"</span>]</div>
              <div className="code-line">{'}'});</div>
            </>
          )}

          {(step === 'acting' || step === 'waiting' || step === 'done') && (
            <div className="code-line mt-4">
              <span className="comment">// Agent attempts to click "Pay Now"</span><br/>
              <span className="keyword">await</span> tab.click(<span className="string">"#submit-payment"</span>);
            </div>
          )}
        </div>
      </div>

      {/* User/Bridge Side */}
      <div className="demo-panel user-panel">
        <div className="panel-header">
          <span className="dot bg-blue"></span>
          <h3>AgentBridge Control</h3>
        </div>
        
        <div className="panel-body">
          {/* Dynamic UI based on state */}
          {step === 'idle' || step === 'planning' ? (
            <div className="empty-state">Waiting for agent activity...</div>
          ) : step === 'requesting' ? (
            <div className="modal-card">
              <h4>Permission Request</h4>
              <p>Agent wants to access <strong>billing.com</strong></p>
              <button className="btn btn-primary" onClick={approvePermissions}>Grant Access</button>
            </div>
          ) : step === 'waiting' ? (
            <div className="modal-card danger">
              <h4>Approval Required</h4>
              <p>Agent is attempting to click <strong>#submit-payment</strong>.</p>
              <div className="flex-gap">
                <button className="btn btn-primary" onClick={approveAction}>Approve</button>
                <button className="btn btn-secondary" onClick={denyAction}>Deny</button>
              </div>
            </div>
          ) : step === 'acting' ? (
            <div className="empty-state active">Monitoring agent actions...</div>
          ) : (
            <div className="modal-card success">
              <h4>Task Finished</h4>
              <p>Audit trail saved.</p>
              <button className="btn btn-secondary" onClick={() => setStep('idle')}>Reset Demo</button>
            </div>
          )}

          {/* Audit Log */}
          <div className="audit-log">
            <div className="log-header">Live Audit Ledger</div>
            <div className="log-content">
              {logs.map((log, i) => (
                <div key={i} className="log-entry">{log}</div>
              ))}
              {logs.length === 0 && <span className="text-tertiary">No events yet</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
