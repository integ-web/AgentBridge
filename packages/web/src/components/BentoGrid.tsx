import './BentoGrid.css';

export const BentoGrid: React.FC = () => {
  return (
    <div className="bento-grid">
      <div className="bento-item wide glass">
        <div className="bento-content">
          <span className="bento-icon">🛡️</span>
          <h3>Restriction Compliance Layer</h3>
          <p>
            Enforce traffic budgets, block injection attempts, and automatically detect CAPTCHAs before the agent wastes tokens.
          </p>
        </div>
      </div>
      
      <div className="bento-item glass">
        <div className="bento-content">
          <span className="bento-icon">📜</span>
          <h3>Evidence Ledger</h3>
          <p>
            Tamper-evident cryptographic hash chains of every action the agent takes, securely saved to your local machine.
          </p>
        </div>
      </div>

      <div className="bento-item glass">
        <div className="bento-content">
          <span className="bento-icon">👁️</span>
          <h3>Automatic Redaction</h3>
          <p>
            Passwords, credit cards, and API keys are scrubbed from the DOM before the AI model ever sees the page snapshot.
          </p>
        </div>
      </div>

      <div className="bento-item wide glass">
        <div className="bento-content">
          <span className="bento-icon">🔌</span>
          <h3>Universal SDK</h3>
          <p>
            Works with any AI agent framework (LangChain, AutoGPT, custom). Just point your agent at the local daemon and go.
          </p>
        </div>
      </div>
    </div>
  );
};
