import { InteractiveDemo } from './components/InteractiveDemo';
import { BentoGrid } from './components/BentoGrid';

function App() {
  return (
    <div className="app-container">
      <nav className="navbar glass">
        <div className="logo">
          <span className="logo-icon">🌉</span>
          <span className="logo-text">AgentBridge</span>
        </div>
        <div className="nav-links">
          <a href="#features">Features</a>
          <a href="#demo">Demo</a>
          <a href="https://github.com/agentbridge/agentbridge" target="_blank" rel="noreferrer" className="btn btn-secondary">GitHub</a>
        </div>
      </nav>

      <main>
        <section className="hero">
          <div className="hero-content">
            <div className="badge pulse">Public Alpha Available Now</div>
            <h1 className="hero-title">
              The secure browser workspace <br />
              <span className="text-gradient">for AI agents.</span>
            </h1>
            <p className="hero-subtitle">
              AgentBridge puts a protective layer between AI agents and the web. 
              Permission-first. Restriction-aware. Evidence by default.
            </p>
            <div className="hero-cta">
              <a href="#demo" className="btn btn-primary btn-large">Try the Interactive Demo</a>
              <code className="install-code">npm install @agentbridge/sdk</code>
            </div>
          </div>
          
          <div className="hero-glow"></div>
        </section>

        <section id="demo" className="demo-section">
          <div className="section-header">
            <h2>Experience the Bridge</h2>
            <p>Watch an agent try to complete a task, and see how AgentBridge keeps you in control.</p>
          </div>
          <InteractiveDemo />
        </section>

        <section id="features" className="features-section">
          <div className="section-header">
            <h2>Built for Trust</h2>
            <p>The tools you need to deploy autonomous agents without the anxiety.</p>
          </div>
          <BentoGrid />
        </section>
      </main>

      <footer className="footer glass">
        <div className="footer-content">
          <div className="footer-brand">
            <span className="logo-icon">🌉</span>
            <span>AgentBridge</span>
          </div>
          <p className="footer-copy">&copy; 2026 AgentBridge. Open Source under MIT.</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
