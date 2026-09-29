import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, RefreshCw, Save } from 'lucide-react'
import {
  fetchCanonicalHistory,
  fetchGroomingReadiness,
  recordCanonicalGroomingDecision,
  setCanonicalGroomingBlocker,
  setCanonicalGroomingContext,
  upsertCanonicalGroomingQuestion,
  type GroomingReadinessDto,
  type CanonicalHistoryEventDto,
} from '../api/blink'
import type { WizardState } from '../wizard/types'

interface Props {
  state: WizardState
}

function digest(value: unknown): string {
  const raw = JSON.stringify(value)
  let hash = 2166136261
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

/** Backend-owned project grooming facts, layered over legacy per-story G-GROOM. */
export function GovernedGroomingPanel({ state }: Props) {
  const [readiness, setReadiness] = useState<GroomingReadinessDto | null>(null)
  const [history, setHistory] = useState<CanonicalHistoryEventDto[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [decision, setDecision] = useState('')
  const [blocker, setBlocker] = useState('')
  const syncedQuestions = useRef('')

  const refresh = async () => {
    if (!state.projectId) return
    setBusy(true)
    try {
      const [result, eventHistory] = await Promise.all([
        fetchGroomingReadiness(state.projectId),
        fetchCanonicalHistory(state.projectId, 5).catch(() => ({ events: [] as CanonicalHistoryEventDto[] })),
      ])
      setReadiness(result.readiness)
      setHistory(eventHistory.events || [])
      setError(null)
    } catch (cause) {
      setReadiness(null)
      setError(cause instanceof Error ? cause.message : 'Project grooming is not available yet.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!state.projectId) {
      setReadiness(null)
      setError(null)
      return
    }
    void refresh()
    // Project identity is the lifecycle boundary; answers refresh after user actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.projectId])

  useEffect(() => {
    if (!state.projectId) return
    const questions = state.questions.map((question) => ({
      key: question.id,
      prompt: question.question,
      mandatory: Boolean(question.mandatory),
      assignedRoleId: question.assignedRoleId,
      sourceDigest: digest({ id: question.id, question: question.question, mandatory: question.mandatory }),
    }))
    const signature = JSON.stringify(questions)
    if (!questions.length || signature === syncedQuestions.current) return
    syncedQuestions.current = signature
    void Promise.all(questions.map((question) => upsertCanonicalGroomingQuestion(state.projectId!, question)))
      .then(() => refresh())
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not synchronize project questions.'))
    // The signature deliberately owns question synchronization, not response writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.projectId, state.questions])

  const saveContext = async () => {
    if (!state.projectId) return
    setBusy(true)
    try {
      await setCanonicalGroomingContext(state.projectId, {
        key: 'inherited-project-context',
        context: {
          requirementDigest: digest(state.groomDraft || state.requirementsText || state.description),
          requirement: state.groomDraft || state.requirementsText || state.description,
          productScopeDigest: state.productScope?.confirmationDigest || state.productScope?.proposalDigest || '',
          productScope: state.productScope?.markdown || '',
        },
      })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save inherited context.')
    } finally {
      setBusy(false)
    }
  }

  const saveDecision = async () => {
    if (!state.projectId || !decision.trim()) return
    setBusy(true)
    try {
      await recordCanonicalGroomingDecision(state.projectId, `working-${digest(decision)}`, {
        text: decision.trim(),
        source: 'stakeholder-qa',
      })
      setDecision('')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not record the decision.')
    } finally {
      setBusy(false)
    }
  }

  const saveBlocker = async (resolve = false) => {
    if (!state.projectId || (!resolve && !blocker.trim())) return
    setBusy(true)
    try {
      const key = `ui-${digest(blocker || 'project-grooming')}`
      await setCanonicalGroomingBlocker(state.projectId, resolve
        ? { key, resolve: true }
        : { key, severity: 'blocking', message: blocker.trim(), details: { source: 'stakeholder-qa' } })
      if (!resolve) setBlocker('')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the blocker.')
    } finally {
      setBusy(false)
    }
  }

  if (!state.projectId) return null

  const ready = readiness?.ready
  return (
    <section className="sdlc-panel" style={{ marginBottom: '1.5rem' }}>
      <div className="sdlc-panel__head">
        {ready ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
        <div>
          <h3>Project grooming readiness</h3>
          <p className="muted">Canonical project context that feeds story-level G-GROOM without replacing it.</p>
        </div>
      </div>
      {readiness ? (
        <>
          <p className={ready ? 'sdlc-timeline__outcome' : 'sdlc-timeline__outcome is-blocked'}>
            {ready
              ? `Current at revision ${readiness.revision}.`
              : `${readiness.mandatoryPending} mandatory answer(s) and ${readiness.openBlockers} blocking item(s) remain.`}
          </p>
          {readiness.reasons.length ? <p className="muted small">Reasons: {readiness.reasons.join(', ')}</p> : null}
        </>
      ) : null}
      {error ? <p className="sdlc-timeline__outcome is-blocked">{error}</p> : null}
      {history.length ? (
        <p className="muted small">
          Recent canonical activity: {history.slice(0, 3).map((event) => event.eventType).join(' · ')}
        </p>
      ) : null}
      <div className="ship-actions" style={{ marginTop: '0.75rem' }}>
        <button type="button" className="ghost-btn" disabled={busy} onClick={() => void refresh()}>
          <RefreshCw size={14} className={busy ? 'spin' : undefined} /> Refresh readiness
        </button>
        <button type="button" className="ghost-btn" disabled={busy} onClick={() => void saveContext()}>
          <Save size={14} /> Save inherited context
        </button>
      </div>
      <div className="setup-grid-2" style={{ marginTop: '0.75rem' }}>
        <label className="field-group">
          <span>Working decision</span>
          <input value={decision} onChange={(event) => setDecision(event.target.value)} placeholder="Decision stakeholders agreed" />
          <button type="button" className="secondary-btn" disabled={busy || !decision.trim()} onClick={() => void saveDecision()}>
            Record decision
          </button>
        </label>
        <label className="field-group">
          <span>Project blocker</span>
          <input value={blocker} onChange={(event) => setBlocker(event.target.value)} placeholder="What prevents readiness?" />
          <span style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="secondary-btn" disabled={busy || !blocker.trim()} onClick={() => void saveBlocker()}>
              Record blocker
            </button>
            <button type="button" className="ghost-btn" disabled={busy || !blocker.trim()} onClick={() => void saveBlocker(true)}>
              Resolve
            </button>
          </span>
        </label>
      </div>
    </section>
  )
}
