import React from 'react'
import { reportError } from '../lib/errors'

/** A page that crashes shows this instead of a blank screen, and Taimoor hears about it. */
export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { reportError(Object.assign(error || {}, { stack: `${error?.stack || ''}\n${info?.componentStack || ''}` }), 'render') }
  componentDidUpdate(prev) { if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null }) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card max-w-lg mx-auto mt-10 text-center">
        <div className="text-lg font-semibold text-ink mb-1">Something went wrong on this page</div>
        <div className="text-sm text-ink/60 mb-4">It’s been reported automatically. Try again — if it keeps happening, carry on with another page for now.</div>
        <div className="flex gap-2 justify-center">
          <button className="btn btn-secondary" onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload the portal</button>
        </div>
      </div>
    )
  }
}
