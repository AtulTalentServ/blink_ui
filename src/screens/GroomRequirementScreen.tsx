import { useEffect, useRef, useState } from 'react'
import { DocMarkdown } from '../components/DocMarkdown'
import { ChevronDown, Mail, MessageSquare } from 'lucide-react'
import { JiraScopePanel } from './JiraScopePanel'
import { assigneeForQuestion } from '../wizard/questions'
import { roleLabel, STAKEHOLDER_ROLES } from '../wizard/stakeholders'
import type { GroomQuestion, WizardState, WizardStep } from '../wizard/types'
import {
  applyRecommendedAnswers,
  computeClarifyFrontierState,
  isAnswered,
  isDeferredToJira,
  isResolvedForWording,
  recommendedOptionForQuestion,
  splitQuestionTitleAndText,
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
  const [ownerOpen, setOwnerOpen] = useState(false)
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

  const { text: displayText } = splitQuestionTitleAndText(question.title, question.text)

  return (
    <div className="groom-question" role="group" aria-labelledby={`groom-q-${question.id}`}>
      <div className="groom-question-legend" id={`groom-q-${question.id}`}>
        <span className="groom-q-mark">
          <span className="groom-q-number">Q{index + 1}</span>
          {(question.round ?? 1) > 1 ? (
            <span className="groom-round-pill">Round {question.round}</span>
          ) : null}
        </span>
        <span className="groom-question-text">{displayText}</span>
        {isMultiple ? <span className="groom-question-badge">Select all that apply</span> : null}
        <div className="groom-owner">
          <button
            type="button"
            className={`groom-owner-chip${ownerOpen ? ' is-open' : ''}${assignee.assigned ? '' : ' is-unassigned'}`}
            aria-expanded={ownerOpen}
            onClick={() => setOwnerOpen((open) => !open)}
          >
            <span
              className={`stakeholder-avatar tone-${avatarTone(assignee.assigned ? assignee.name : roleLabel(roleId))}`}
              aria-hidden="true"
            >
              {initials(assignee.assigned ? assignee.name : roleLabel(roleId))}
            </span>
            <span className="groom-owner-name">{assignee.assigned ? assignee.name : 'Unassigned'}</span>
            <span className="groom-owner-role">{roleLabel(roleId)}</span>
            {question.queueEmail ? <Mail size={13} aria-label="Email later" /> : null}
            {question.queueJira ? <MessageSquare size={13} aria-label="Jira later" /> : null}
            <ChevronDown size={14} className={ownerOpen ? 'chevron open' : 'chevron'} />
          </button>
        </div>
        {ownerOpen ? (
            <div className="groom-owner-panel">
              {!assignee.assigned ? (
                <p className="groom-owner-note">
                  Assign this role first
                  {onNavigate ? (
                    <>
                      {' · '}
                      <button type="button" className="text-btn" onClick={() => onNavigate('project-stakeholders')}>
                        Open stakeholders
                      </button>
                    </>
                  ) : null}
                </p>
              ) : (
                <p className="groom-owner-note">{assignee.email}</p>
              )}
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
        ) : null}
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
                    <span className="groom-recommended-pill" title="Suggested answer, already selected">
                      Recommended
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
    </div>
  )
}

export function GroomingPanel({
  state,
  loading,
  onPick,
  onOther,
  onToggleOther,
  onAsk,
  onStartOver,
  onUpdate,
  onNavigate,
  showJiraPanel = true,
}: Props) {
  const {
    asked,
    round,
    frontierEmpty,
    frontierQuestions,
    settledQuestions,
    resolvedCount,
    unresolvedCount,
  } = computeClarifyFrontierState(state)
  const [wordingOpen, setWordingOpen] = useState(false)
  const [editingDraft, setEditingDraft] = useState(false)
  const seededQuestionIds = useRef(new Set<string>())

  useEffect(() => {
    const live = new Set(state.groomQuestions.map((question) => question.id).filter(Boolean))
    for (const id of seededQuestionIds.current) {
      if (!live.has(id)) seededQuestionIds.current.delete(id)
    }
    if (state.groomConfirmed || live.size === 0) return
    const fresh = state.groomQuestions.filter(
      (question) =>
        question.id &&
        !seededQuestionIds.current.has(question.id) &&
        !isResolvedForWording(question, state.groomAnswers),
    )
    for (const id of live) seededQuestionIds.current.add(id)
    if (!fresh.length) return
    onUpdate({ groomAnswers: applyRecommendedAnswers(fresh, state.groomAnswers) })
  }, [onUpdate, state.groomAnswers, state.groomConfirmed, state.groomQuestions])
  const followUpRound = round > 1 && !state.groomConfirmed && !frontierEmpty
  const showDraft = Boolean(
    state.groomDraft && (state.groomStatus === 'draft_ready' || state.groomConfirmed || followUpRound),
  )
  const draftExpanded = wordingOpen || frontierEmpty || editingDraft

  return (
    <div className="groom-panel">
      <div className="groom-panel-intro">
        <div className="req-section-head">
          <h3>
            {frontierEmpty
              ? 'Frontier complete — confirm shared understanding'
              : followUpRound
                ? `Design frontier · Round ${round}`
                : 'Clarify design frontier'}
          </h3>
        </div>
        {asked ? (
          <div className="groom-toolbar">
            {frontierQuestions.length > 0 ? (
              <p className="groom-progress">
                {resolvedCount}/{frontierQuestions.length} answered in Round {round}
              </p>
            ) : null}
            {frontierQuestions.length > 0 && unresolvedCount > 0 && !state.groomConfirmed ? (
              <button
                type="button"
                className="secondary-btn"
                disabled={loading}
                onClick={() =>
                  onUpdate({
                    groomAnswers: applyRecommendedAnswers(frontierQuestions, state.groomAnswers),
                    groomConfirmed: false,
                  })
                }
              >
                Accept recommended ({unresolvedCount})
              </button>
            ) : null}
            <button
              type="button"
              className="ghost-btn"
              disabled={loading}
              onClick={() => {
                onStartOver()
                if (onAsk) window.setTimeout(() => onAsk(), 0)
              }}
            >
              Start over
            </button>
          </div>
        ) : null}
      </div>

      {!asked && loading ? <p className="muted">Mapping the design-tree frontier…</p> : null}
      {asked && loading ? <p className="muted">Updating wording &amp; checking next frontier…</p> : null}

      {state.groomStatus === 'error' && state.groomMessage ? (
        <p className="muted">{state.groomMessage}</p>
      ) : null}

      {settledQuestions.length > 0 ? (
        <details className="groom-settled-rounds">
          <summary>
            Settled in earlier rounds ({settledQuestions.length} decision{settledQuestions.length === 1 ? '' : 's'})
          </summary>
          <div className="groom-frontier-list">
            {settledQuestions.map((question, idx) => (
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
        </details>
      ) : null}

      {frontierQuestions.length > 0 ? (
        <div className="groom-frontier-list">
          {frontierQuestions.map((question, idx) => (
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
        <section className={`groom-band${draftExpanded ? ' open' : ''}`}>
          <button
            type="button"
            className="groom-band-header"
            aria-expanded={draftExpanded}
            onClick={() => setWordingOpen((open) => !open)}
          >
            <div className="req-section-head">
              <h3>
                {state.groomConfirmed
                  ? 'Confirmed wording'
                  : frontierEmpty
                    ? 'Shared understanding'
                    : 'Clearer wording'}
              </h3>
            </div>
            <span className="groom-band-meta">
              {state.groomConfirmed ? 'Saved' : frontierEmpty ? 'Ready to confirm' : 'Draft'}
              {draftExpanded ? 'Hide' : 'Show'}
              <span className="groom-band-chevron" aria-hidden>
                <ChevronDown size={16} className={draftExpanded ? 'chevron open' : 'chevron'} />
              </span>
            </span>
          </button>
          {draftExpanded ? (
            <div className={`groom-compare${state.groomOriginal && state.groomOriginal !== state.groomDraft ? '' : ' is-single'}`}>
              {state.groomOriginal && state.groomOriginal !== state.groomDraft && (
                <div>
                  <h4>Before</h4>
                  <DocMarkdown className="groom-draft" text={state.groomOriginal || ''} />
                </div>
              )}
              <div>
                <div className="groom-compare-head">
                  {state.groomOriginal && state.groomOriginal !== state.groomDraft ? (
                    <h4>Proposed</h4>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => setEditingDraft((open) => !open)}
                  >
                    {editingDraft ? 'Done editing' : 'Edit wording'}
                  </button>
                </div>
                {editingDraft ? (
                  <textarea
                    className="req-textarea"
                    rows={8}
                    aria-label="Edit synthesized requirement wording"
                    value={state.groomDraft || ''}
                    onChange={(event) =>
                      onUpdate({
                        groomDraft: event.target.value,
                        ...(state.groomConfirmed ? { requirementsText: event.target.value } : {}),
                      })
                    }
                  />
                ) : (
                  <DocMarkdown className="groom-draft" text={state.groomDraft || ''} />
                )}
              </div>
            </div>
          ) : null}
        </section>
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
