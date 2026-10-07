import { useState } from 'react'
import { Check, ChevronDown, Mail, MessageSquare } from 'lucide-react'
import { JiraScopePanel } from './JiraScopePanel'
import { assigneeForQuestion } from '../wizard/questions'
import { roleLabel, STAKEHOLDER_ROLES } from '../wizard/stakeholders'
import type { GroomQuestion, WizardState, WizardStep } from '../wizard/types'
import {
  GROOM_BANDS,
  isAnswered,
  isDeferredToJira,
  isResolvedForWording,
  questionPriority,
  questionsInBand,
  unansweredRequired,
  type GroomPriority,
} from '../wizard/grooming'

interface Props {
  state: WizardState
  loading: boolean
  onPick: (questionId: string, optionId: string, optionLabel: string) => void
  onOther: (questionId: string, text: string) => void
  onToggleOther: (questionId: string, checked: boolean) => void
  onUseWording?: () => void
  onStartOver: () => void
  onUpdate: (patch: Partial<WizardState>) => void
  onNavigate?: (step: WizardStep) => void
  showJiraPanel?: boolean
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function avatarTone(name: string): number {
  const seed = name.trim() || '?'
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash + seed.charCodeAt(i)) % 6
  return hash
}

function QuestionCard({
  question,
  state,
  onPick,
  onOther,
  onToggleOther,
  onUpdate,
  onNavigate,
}: {
  question: GroomQuestion
  state: WizardState
  onPick: Props['onPick']
  onOther: Props['onOther']
  onToggleOther: Props['onToggleOther']
  onUpdate: Props['onUpdate']
  onNavigate?: Props['onNavigate']
}) {
  const options = (Array.isArray(question.options) ? question.options : []).filter(
    (option) => option.id !== 'other' && option.label.trim().toLowerCase() !== 'other',
  )
  if (!question.id || !question.text || options.length < 2) return null

  const roleId = question.ownerRole || 'product_owner'
  const assignee = assigneeForQuestion(state, roleId)
  const isMultiple = Boolean(question.allowMultiple)
  const selectedIds = new Set(
    state.groomAnswers.filter((item) => item.questionId === question.id).map((item) => item.optionId),
  )
  const otherAnswer = state.groomAnswers.find((item) => item.questionId === question.id && item.optionId === 'other')
  const [showOtherText, setShowOtherText] = useState(Boolean(otherAnswer))
  const isOtherSelected = Boolean(otherAnswer) || showOtherText

  function patchQuestion(updates: Partial<GroomQuestion>) {
    onUpdate({
      groomQuestions: state.groomQuestions.map((item) =>
        item.id === question.id ? { ...item, ...updates } : item,
      ),
    })
  }

  function toggleOther(checked: boolean) {
    setShowOtherText(checked)
    onToggleOther(question.id, checked)
  }

  return (
    <fieldset className="groom-question">
      <legend className="groom-question-legend">
        <span className="groom-question-text">{question.text}</span>
        <span className="groom-question-badge">
          {isMultiple ? 'Select all that apply' : 'Select one'}
        </span>
      </legend>
      {question.subtitle ? <p className="groom-question-subtitle">{question.subtitle}</p> : null}

      <div className={`groom-assignee${assignee.assigned ? '' : ' is-unassigned'}`}>
        <span
          className={`stakeholder-avatar tone-${avatarTone(assignee.assigned ? assignee.name : roleLabel(roleId))}`}
          aria-hidden="true"
        >
          {initials(assignee.assigned ? assignee.name : roleLabel(roleId))}
        </span>
        <div className="groom-assignee-who">
          <strong>{assignee.assigned ? assignee.name : 'Not assigned'}</strong>
          {assignee.assigned ? (
            <span>{assignee.email}</span>
          ) : (
            <span>
              Assign this role first
              {onNavigate ? (
                <>
                  {' · '}
                  <button type="button" className="text-btn" onClick={() => onNavigate('project-stakeholders')}>
                    Open stakeholders
                  </button>
                </>
              ) : null}
            </span>
          )}
        </div>
        <label className="groom-assignee-role">
          <span>Role</span>
          <select
            value={roleId}
            aria-label="Question owner role"
            onChange={(event) => patchQuestion({ ownerRole: event.target.value })}
          >
            {STAKEHOLDER_ROLES.map((role) => (
              <option key={role.id} value={role.id}>
                {role.label}
              </option>
            ))}
          </select>
        </label>
        <div className="groom-queue-row">
          <label className={`groom-queue-toggle${question.queueEmail ? ' on' : ''}${!assignee.assigned ? ' disabled' : ''}`}>
            <input
              type="checkbox"
              checked={Boolean(question.queueEmail)}
              disabled={!assignee.assigned}
              onChange={(event) => patchQuestion({ queueEmail: event.target.checked })}
            />
            <Mail size={13} />
            Email later
          </label>
          <label className={`groom-queue-toggle${question.queueJira ? ' on' : ''}${!assignee.assigned ? ' disabled' : ''}`}>
            <input
              type="checkbox"
              checked={Boolean(question.queueJira)}
              disabled={!assignee.assigned}
              onChange={(event) => patchQuestion({ queueJira: event.target.checked })}
            />
            <MessageSquare size={13} />
            Jira later
          </label>
        </div>
      </div>
      {isDeferredToJira(question) ? (
        <p className="groom-defer-hint">
          Skipped here — will ask {assignee.name} on a Jira ticket after epics/stories exist.
          {isAnswered(question, state.groomAnswers) ? ' Your in-app choice is kept as a proposed answer.' : ''}
        </p>
      ) : null}

      <div className={`groom-options${isDeferredToJira(question) && !isAnswered(question, state.groomAnswers) ? ' is-deferred' : ''}`}>
        {options.map((option) => {
          const checked = selectedIds.has(option.id)
          return (
            <label key={option.id} className={`groom-option ${checked ? 'selected' : ''}`}>
              <input
                type={isMultiple ? 'checkbox' : 'radio'}
                name={isMultiple ? undefined : question.id}
                checked={checked}
                onChange={() => onPick(question.id, option.id, option.label)}
              />
              <div className="groom-option-content">
                <span className="groom-option-label">{option.label}</span>
                {option.description ? <span className="groom-option-desc">{option.description}</span> : null}
              </div>
            </label>
          )
        })}
        {question.allowOther !== false && (
          <>
            <label className={`groom-option ${isOtherSelected ? 'selected' : ''}`}>
              <input
                type={isMultiple ? 'checkbox' : 'radio'}
                name={isMultiple ? undefined : question.id}
                checked={isOtherSelected}
                onChange={(e) => toggleOther(e.target.checked)}
              />
              <div className="groom-option-content">
                <span className="groom-option-label">Other</span>
                <span className="groom-option-desc">Enter your custom suggestion</span>
              </div>
            </label>
            {isOtherSelected ? (
              <textarea
                className="full-input groom-other-input"
                rows={3}
                placeholder="Enter your custom suggestion here..."
                value={otherAnswer?.otherText ?? ''}
                onChange={(e) => onOther(question.id, e.target.value)}
                autoFocus
              />
            ) : null}
          </>
        )}
      </div>
    </fieldset>
  )
}

function Band({
  band,
  questions,
  state,
  defaultOpen,
  onPick,
  onOther,
  onToggleOther,
  onUpdate,
  onNavigate,
}: {
  band: (typeof GROOM_BANDS)[number]
  questions: GroomQuestion[]
  state: WizardState
  defaultOpen: boolean
  onPick: Props['onPick']
  onOther: Props['onOther']
  onToggleOther: Props['onToggleOther']
  onUpdate: Props['onUpdate']
  onNavigate?: Props['onNavigate']
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (!questions.length) return null
  const resolved = questions.filter((question) => isResolvedForWording(question, state.groomAnswers)).length
  return (
    <section className={`groom-band ${band.required ? 'required' : 'optional'} ${open ? 'open' : ''}`}>
      <button type="button" className="groom-band-header" onClick={() => setOpen((value) => !value)}>
        <span className="groom-band-title">
          {band.title}
          {band.required ? <span className="groom-required-tag">Required</span> : <span className="optional-tag">Optional</span>}
        </span>
        <span className="groom-band-meta">
          {resolved}/{questions.length} resolved
          <span className="groom-band-chevron" aria-hidden>
            <ChevronDown size={16} className={open ? 'chevron open' : 'chevron'} />
          </span>
        </span>
      </button>
      {open && (
        <>
          <p className="groom-band-hint">{band.hint}</p>
          {questions.map((question) => (
            <QuestionCard
              key={question.id}
              question={question}
              state={state}
              onPick={onPick}
              onOther={onOther}
              onToggleOther={onToggleOther}
              onUpdate={onUpdate}
              onNavigate={onNavigate}
            />
          ))}
        </>
      )}
    </section>
  )
}

export function GroomingPanel({
  state,
  loading,
  onPick,
  onOther,
  onToggleOther,
  onStartOver,
  onUpdate,
  onNavigate,
  showJiraPanel = true,
}: Props) {
  const questions = state.groomQuestions
  const missingRequired = unansweredRequired(state)
  const asked = questions.length > 0 || state.groomStatus === 'draft_ready' || state.groomStatus === 'error'
  const showDraft = Boolean(state.groomDraft && (state.groomStatus === 'draft_ready' || state.groomConfirmed))
  const required = questionsInBand(questions, 'need_clarification')
  const optional = questions.filter((question) => questionPriority(question) !== 'need_clarification')
  const requiredResolved = required.filter((question) =>
    isResolvedForWording(question, state.groomAnswers),
  ).length
  const optionalResolved = optional.filter((question) =>
    isResolvedForWording(question, state.groomAnswers),
  ).length
  const canSave = missingRequired.length === 0 || state.groomStatus === 'error'
  const [wordingOpen, setWordingOpen] = useState(false)

  return (
    <div className="groom-panel">
      <div className="groom-panel-intro">
        <div className="req-section-head">
          <h3>Make it clearer</h3>
          <p>Answer required questions, or mark Jira later to follow up after tickets exist.</p>
        </div>
        {asked && questions.length > 0 ? (
          <p className="groom-progress">
            {requiredResolved}/{required.length} required
            {optional.length > 0 ? ` · ${optionalResolved}/${optional.length} optional` : ''}
          </p>
        ) : null}
      </div>

      {!asked && loading ? <p className="muted">Reading the requirement…</p> : null}
      {asked && loading ? <p className="muted">Updating the wording…</p> : null}

      {state.groomMessage && asked && <p className="muted">{state.groomMessage}</p>}

      {GROOM_BANDS.map((band) => (
        <Band
          key={band.id}
          band={band}
          questions={questionsInBand(questions, band.id as GroomPriority)}
          state={state}
          defaultOpen={band.required}
          onPick={onPick}
          onOther={onOther}
          onToggleOther={onToggleOther}
          onUpdate={onUpdate}
          onNavigate={onNavigate}
        />
      ))}

      {showDraft && (
        <section className={`groom-band${wordingOpen ? ' open' : ''}`}>
          <button
            type="button"
            className="groom-band-header"
            aria-expanded={wordingOpen}
            onClick={() => setWordingOpen((open) => !open)}
          >
            <div className="req-section-head">
              <h3>{state.groomConfirmed ? 'Confirmed wording' : 'Clearer wording'}</h3>
              <p>
                {wordingOpen
                  ? 'Click to hide the requirement text'
                  : 'Click to view the requirement text'}
              </p>
            </div>
            <span className="groom-band-meta">
              {state.groomConfirmed ? 'Saved' : 'Draft'}
              {wordingOpen ? 'Hide' : 'Show'}
              <span className="groom-band-chevron" aria-hidden>
                <ChevronDown size={16} className={wordingOpen ? 'chevron open' : 'chevron'} />
              </span>
            </span>
          </button>
          {wordingOpen ? (
            <div className={`groom-compare${state.groomOriginal && state.groomOriginal !== state.groomDraft ? '' : ' is-single'}`}>
              {state.groomOriginal && state.groomOriginal !== state.groomDraft && (
                <div>
                  <h4>Before</h4>
                  <pre className="groom-draft">{state.groomOriginal}</pre>
                </div>
              )}
              <div>
                {state.groomOriginal && state.groomOriginal !== state.groomDraft ? <h4>Proposed</h4> : null}
                <pre className="groom-draft">{state.groomDraft}</pre>
              </div>
            </div>
          ) : null}
        </section>
      )}

      {asked && (
        <div className="card-footer-actions">
          <button type="button" className="ghost-btn" disabled={loading} onClick={onStartOver}>
            Start over
          </button>
          <span className="action-spacer" />
          {state.groomConfirmed ? (
            <p className="quiet-hint groom-continue-hint">
              <Check size={14} aria-hidden /> Wording saved — click Continue below.
            </p>
          ) : (
            <p className="quiet-hint groom-continue-hint">
              {loading
                ? 'Updating wording…'
                : canSave
                  ? 'Answer the questions, then click Continue to save the wording.'
                  : `Answer or mark Jira later on ${missingRequired.length} required question${
                      missingRequired.length === 1 ? '' : 's'
                    }.`}
            </p>
          )}
        </div>
      )}

      {showJiraPanel && state.groomConfirmed && (
        <JiraScopePanel
          state={state}
          onUpdate={onUpdate}
          sourceText={state.groomDraft || state.requirementsText}
        />
      )}
    </div>
  )
}
