import { AlertCircle, CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'
import type { ImplementRunState, ImplementRunStep } from './implementRunTypes'

function stepIcon(step: ImplementRunStep) {
  if (step.status === 'completed') return <CheckCircle2 size={16} className="implement-run-step-icon is-done" />
  if (step.status === 'failed') return <XCircle size={16} className="implement-run-step-icon is-fail" />
  return <Loader2 size={16} className="implement-run-step-icon spin is-active" />
}

type Props = {
  state: ImplementRunState
}

export function ImplementRunStatusPanel({ state }: Props) {
  const current = [...state.steps].reverse().find((s) => s.status === 'active')

  return (
    <section className="implement-run-status" aria-live="polite">
      <header className="implement-run-status__head">
        <strong>Run status</strong>
        {state.running ? (
          <span className="implement-run-status__badge is-running">
            <Loader2 size={14} className="spin" aria-hidden />
            Running
          </span>
        ) : state.finished?.ok ? (
          <span className="implement-run-status__badge is-ok">Completed</span>
        ) : state.finished ? (
          <span className="implement-run-status__badge is-fail">Failed</span>
        ) : (
          <span className="implement-run-status__badge">Idle</span>
        )}
      </header>

      {current ? (
        <p className="implement-run-status__current">
          <Circle size={12} aria-hidden />
          Now: <span>{current.title}</span>
          {current.detail ? <em>{current.detail}</em> : null}
        </p>
      ) : null}

      {state.finished?.summary ? (
        <p className={`implement-run-status__summary${state.finished.ok ? ' is-ok' : ' is-fail'}`}>
          {state.finished.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          {state.finished.summary}
        </p>
      ) : null}

      {state.steps.length > 0 ? (
        <ol className="implement-run-steps">
          {state.steps.map((step) => (
            <li key={`${step.stepId}-${step.timestamp}`} className={`implement-run-step is-${step.status}`}>
              {stepIcon(step)}
              <div>
                <span className="implement-run-step__title">{step.title}</span>
                {step.detail ? <span className="implement-run-step__detail">{step.detail}</span> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {state.logs.filter((l) => l.stream !== 'cursor_json').length > 0 ? (
        <details className="implement-run-logs">
          <summary>Technical logs ({state.logs.length})</summary>
          <pre>
            {state.logs
              .slice(-30)
              .map((l) => `[${l.stream}] ${l.message}`)
              .join('\n')}
          </pre>
        </details>
      ) : null}
    </section>
  )
}
