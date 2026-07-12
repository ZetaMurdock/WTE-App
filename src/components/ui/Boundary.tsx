import { Component, type ReactNode } from "react";

// Containment: a crash inside a heavy surface (e.g. the VTT engine) must never
// unmount the whole app shell.
export class Boundary extends Component<{ label: string; children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { err: e instanceof Error ? e.message : String(e) };
  }
  render() {
    if (this.state.err)
      return (
        <div className="dashboard">
          <p className="list-empty">
            {this.props.label} hit an error: {this.state.err}
          </p>
          <button className="ghost-btn" onClick={() => this.setState({ err: null })}>
            Retry
          </button>
        </div>
      );
    return this.props.children;
  }
}
