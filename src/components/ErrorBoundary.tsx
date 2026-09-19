import { Component, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) { console.error(error) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto mt-10 max-w-lg rounded-xl border border-line bg-surface p-6 text-center">
        <TriangleAlert className="mx-auto text-critical" />
        <h2 className="mt-2 font-semibold text-ink">Something went wrong on this page</h2>
        <p className="mt-1 text-sm text-muted">{this.state.error.message}</p>
        <button onClick={() => this.setState({ error: null })} className="mt-4 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white">Try again</button>
      </div>
    )
  }
}
