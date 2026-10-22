import { useState } from 'react'
import { DocMarkdown } from '../components/DocMarkdown'
import { Check, ChevronDown, Mail, MessageSquare, Sparkles } from 'lucide-react'
import { JiraScopePanel } from './JiraScopePanel'
import { assigneeForQuestion } from '../wizard/questions'
import { roleLabel, STAKEHOLDER_ROLES } from '../wizard/stakeholders'
import type { GroomQuestion, WizardState, WizardStep } from '../wizard/types'
import {
  applyRecommendedAnswers,
  compactQuestionText,
  isAnswered,
  isDeferredToJira,
  isResolvedForWording,
  recommendedOptionForQuestion,
} from '../wizard/grooming'

interface Props {
  state: WizardState
  loading: boolean
  onPick: (questionId: string, optionId: string, optionLabel: string) => void
  onOther: (questionId: string, text: string) => void
  onToggleOther: (questionId: string, checked: boolean) => void
  onUseWording?: () => void
  onLockWording?: () => void
  onAsk?: () => void
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
  index,
  state,
  onPick,
  onOther,
  onToggleOther,
  onUpdate,
  onNavigate,
}: {
  question: GroomQuestion
  index: number
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

  const recOption = recommendedOptionForQuestion(question)
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
        <span className="groom-q-number">Q{index + 1}</span>
        {(question.round ?? 1) > 1 ? (
          <span className="groom-round-pill">Round {question.round}</span>
        ) : null}
        <span className="groom-question-text">{compactQuestionText(question.text)}</span>
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
          const isRecommended = recOption?.id === option.id
          return (
            <label key={option.id} className={`groom-option ${checked ? 'selected' : ''}`}>
              <input
                type={isMultiple ? 'checkbox' : 'radio'}
                name={isMultiple ? undefined : question.id}
                checked={checked}
                onChange={() => onPick(question.id, option.id, option.label)}
              />
              <div className="groom-option-content">
                <span className="groom-option-label">
                  {option.label}
                  {isRecommended ? (
                    <span className="groom-recommended-pill" title="Agent recommended default">
                      ➡️ Recommended
                    </span>
                  ) : null}
                </span>
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

export function GroomingPanel({
  state,
  loading,
  onPick,
  onOther,
  onToggleOther,
  onUseWording,
  onLockWording,
  onAsk,
  onStartOver,
  onUpdate,
  onNavigate,
  showJiraPanel = true,
}: Props) {
  const questions = state.groomQuestions
  const asked = questions.length > 0 || state.groomStatus === 'draft_ready' || state.groomStatus === 'error'
  const resolvedCount = questions.filter((question) =>
    isResolvedForWording(question, state.groomAnswers),
  ).length
  const unresolvedCount = questions.length - resolvedCount
  const [wordingOpen, setWordingOpen] = useState(false)
  const round = Math.max(1, state.groomRound || 1)
  const followUpRound = round > 1 && !state.groomConfirmed
  const showDraft = Boolean(
    state.groomDraft && (state.groomStatus === 'draft_ready' || state.groomConfirmed || followUpRound),
  )

  return (
    <div className="groom-panel">
      <div className="groom-panel-intro">
        <div className="req-section-head">
          <h3>{followUpRound ? `Design frontier · Round ${round}` : 'Clarify design frontier'}</h3>
          <p>
            {followUpRound
              ? 'Your previous answers unlocked these downstream decisions. Accept recommendations or pick options.'
              : 'Each question includes a recommended answer (➡️). Override any choice or accept recommendations.'}
          </p>
        </div>
        {asked && questions.length > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <p className="groom-progress" style={{ margin: 0 }}>
              {resolvedCount}/{questions.length} answered
            </p>
            {unresolvedCount > 0 && !state.groomConfirmed ? (
              <button
                type="button"
                className="secondary-btn"
                disabled={loading}
                onClick={() =>
                  onUpdate({
                    groomAnswers: applyRecommendedAnswers(questions, state.groomAnswers),
                    groomConfirmed: false,
                  })
                }
              >
                Accept recommended ({unresolvedCount})
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {!asked && loading ? <p className="muted">Mapping the design-tree frontier…</p> : null}
      {asked && loading ? <p className="muted">Updating wording &amp; checking next frontier…</p> : null}

      {state.groomMessage && asked && <p className="muted">{state.groomMessage}</p>}

      {questions.length > 0 ? (
        <div className="groom-frontier-list">
          {questions.map((question, idx) => (
            <QuestionCard
              key={question.id}
              question={question}
              index={idx}
              state={state}
              onPick={onPick}
              onOther={onOther}
              onToggleOther={onToggleOther}
              onUpdate={onUpdate}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : null}

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
                  <DocMarkdown className="groom-draft" text={state.groomOriginal || ''} />
                </div>
              )}
              <div>
                {state.groomOriginal && state.groomOriginal !== state.groomDraft ? <h4>Proposed</h4> : null}
                <DocMarkdown className="groom-draft" text={state.groomDraft || ''} />
              </div>
            </div>
          ) : null}
        </section>
      )}

      {asked && (
        <div className="card-footer-actions">
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              onStartOver()
              if (onAsk) window.setTimeout(() => onAsk(), 0)
            }}
          >
            Start over
          </button>
          <span className="action-spacer" />
          {!state.groomConfirmed && questions.length > 0 && onLockWording ? (
            <button
              type="button"
              className="secondary-btn"
              disabled={loading}
              onClick={onLockWording}
              title="Finish clarifying immediately using current and recommended answers"
            >
              Lock wording now
            </button>
          ) : null}
          <button
            type="button"
            className="primary-btn"
            disabled={loading || state.groomConfirmed || !onUseWording}
            onClick={onUseWording}
          >
            {loading
              ? 'Checking frontier…'
              : state.groomConfirmed
                ? 'Wording saved'
                : questions.length > 0
                  ? unresolvedCount > 0
                    ? 'Accept recommended & continue'
                    : 'Submit answers'
                  : 'Use this wording'}
            {state.groomConfirmed ? <Check size={16} /> : <Sparkles size={16} />}
          </button>
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
