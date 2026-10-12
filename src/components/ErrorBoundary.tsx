import { Component, type ErrorInfo, type ReactNode } from 'react';

export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  /** Switch the boundary to its failure view after a descendant render error. */
  static getDerivedStateFromError() {
    return { failed: true };
  }

  /** Publish a ryanai-error window event containing the caught render error message. */
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('RyanAI UI failed to render', error, info);
    window.dispatchEvent(
      new CustomEvent('ryanai-error', { detail: { error: error.message } }),
    );
  }

  /** Render children until a render error occurs, then show a page reload action. */
  render() {
    if (this.state.failed) {
      return (
        <div
          role="alert"
          className="grid min-h-screen place-content-center gap-4 bg-slate-950 p-8 text-slate-100"
        >
          <h1 className="text-xl font-bold text-cyan-200">
            RyanAI could not load this view
          </h1>
          <p>Reload the page to try again.</p>
          <button
            className="rounded-lg bg-cyan-400 px-4 py-2 text-slate-950"
            onClick={() => window.location.reload()}
          >
            Reload RyanAI
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
