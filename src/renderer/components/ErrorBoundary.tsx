import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode; name: string }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Something went wrong in {this.props.name}.
          </p>
          <p className="text-xs text-[var(--color-text-muted)] opacity-60">
            {this.state.error.message}
          </p>
          <button
            className="text-xs underline text-[var(--color-text-secondary)] mt-2"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
