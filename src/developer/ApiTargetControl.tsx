import { useEffect, useState } from 'react'
import {
  API_TARGET_OPTIONS,
  describeApiTarget,
  getApiTarget,
  setApiTarget,
  type ApiTarget,
} from './apiTarget'

type ApiTargetControlProps = {
  /** Smaller layout for login screen (no developer popup chrome). */
  compact?: boolean
  onTargetChange?: (target: ApiTarget) => void
}

export function ApiTargetControl({ compact, onTargetChange }: ApiTargetControlProps) {
  const [target, setTargetState] = useState<ApiTarget>(() => getApiTarget())
  const [label, setLabel] = useState(() => describeApiTarget())

  useEffect(() => {
    const refresh = () => {
      setTargetState(getApiTarget())
      setLabel(describeApiTarget())
    }
    window.addEventListener('blink-api-target-changed', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('blink-api-target-changed', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const selectTarget = (next: ApiTarget) => {
    setTargetState(next)
    try {
      setApiTarget(next)
      setLabel(describeApiTarget(next))
    } catch {
      /* Storage unavailable */
    }
    onTargetChange?.(next)
  }

  if (compact) {
    return (
      <div className="login-api-target">
        <label htmlFor="login-api-target">
          <span>API backend</span>
          <select
            id="login-api-target"
            value={target}
            disabled={false}
            onChange={(event) => selectTarget(event.target.value as ApiTarget)}
          >
            {API_TARGET_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="login-api-target-hint">{label}</p>
      </div>
    )
  }

  return (
    <section className="dev-chat-model">
      <h2>API backend</h2>
      <p>
        Choose whether Blink calls your local Go API (port 8090) or the hosted Render backend.
        Applies to the wizard and desktop app. Current: {label}.
      </p>
      <label>
        <span>Backend</span>
        <select value={target} onChange={(event) => selectTarget(event.target.value as ApiTarget)}>
          {API_TARGET_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label} · {option.hint}
            </option>
          ))}
        </select>
      </label>
    </section>
  )
}
