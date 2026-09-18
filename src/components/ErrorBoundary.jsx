import React from "react";

/**
 * Catches render errors in a child tree so one broken screen
 * can't take down the whole app shell (nav, header, etc.).
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error: error || true };
  }

  componentDidCatch(error, info) {
    try {
      console.error("League HQ section error:", error, info && info.componentStack);
    } catch { /* ignore */ }
  }

  reset = () => {
    this.setState({ error: null });
    if (typeof this.props.onReset === "function") this.props.onReset();
  };

  reload = () => {
    try { window.location.reload(); } catch { this.reset(); }
  };

  render() {
    if (this.state.error) {
      return (
        <div className="card" role="alert">
          <div className="v" style={{ color: "var(--now)" }}>This section ran into a problem</div>
          <div className="empty" style={{ paddingTop: 8 }}>
            Try reloading. Your other tabs and settings should still work.
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={this.reload}>Reload</button>
            <button type="button" className="btn ghost" onClick={this.reset}>Try again</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
