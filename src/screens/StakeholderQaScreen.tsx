import { useEffect, useState } from 'react'
import { GroomingPanel } from './GroomRequirementScreen'
import { DesignOptionsPanel } from './DesignOptionsPanel'
import { JiraScopePanel } from './JiraScopePanel'
import { ScopeStartStatus, validateSdlcScope, scopeConfirmed } from './SdlcPlanningScreen'
import {
  StakeholderQuestionsScreen,
  jiraCommentForQuestion,
  validateStakeholderQuestions,
} from './StakeholderQuestionsScreen'
import {
  StakeholderResponsesScreen,
  shouldAutoRunGroomingLoop,
  validateStakeholderResponses,
} from './StakeholderResponsesScreen'
import type { QuestionResponse, StakeholderQuestion, WizardState, WizardStep } from '../wizard/types'
import { shouldAutoStartClarify, type JiraPublishState } from '../wizard/thinking'

type QaTab = 'clarify' | 'stakeholders' | 'tickets'

const QA_STEPS: { id: QaTab; label: string; title: string; detail: string }[] = [
  {
    id: 'clarify',
    label: 'Clarify',
    title: 'Clarify',
    detail: 'Work with the agent on clearer requirement wording, then confirm it.',
  },
  {
    id: 'stakeholders',
    label: 'Stakeholders',
    title: 'Stakeholders',
    detail: 'Send questions, collect answers, then acknowledge G-GROOM.',
  },
  {
    id: 'tickets',
    label: 'Scope & tickets',
    title: 'Scope & tickets',
    detail: 'Propose epics and stories from the confirmed requirement, then start the SDLC.',
  },
]

interface Props {
  state: WizardState
  onUpdate: (patch: Partial<WizardState>) => void
  onAsk?: () => void
  onPick?: (questionId: string, optionId: string, optionLabel: string) => void
  onOther?: (questionId: string, text: string) => void
  onToggleOther?: (questionId: string, checked: boolean) => void
  onUseWording?: () => void
  onStartOver?: () => void
  grooming?: boolean
  jiraPublish?: JiraPublishState | null
  onSendOne: (questionId: string) => Promise<void>
  onSendAll: () => Promise<void>
  onPostJira: (questionId: string) => Promise<boolean | void>
  onPostAllJira: () => Promise<void>
  onRefreshJira: () => Promise<void>
  onSimulateResponses: () => void | Promise<void>
  onResetSimulatedReplies?: () => void | Promise<void>
  onUpdateResponse?: (questionId: string, patch: Partial<QuestionResponse>) => void | Promise<void>
  onResolveAllLatest?: () => void
  onPatchQuestion?: (questionId: string, patch: Partial<StakeholderQuestion>) => void
  onNavigate?: (step: WizardStep) => void
  sending?: boolean
  posting?: boolean
  refreshing?: boolean
  simulating?: boolean
  resetting?: boolean
}

/**
 Ideal SDLC order for this step:
 1) Clarify wording with the agent
 2) Stakeholders — send questions, resolve answers, acknowledge G-GROOM
 3) Scope & tickets — propose epics/stories from confirmed requirement
*/
function defaultTab(state: WizardState): QaTab {
  if (state.requirementsText.trim() && !state.groomConfirmed) return 'clarify'
  if (state.groomAcknowledged && !scopeConfirmed(state)) return 'tickets'
  if (state.groomConfirmed) return 'stakeholders'
  return 'clarify'
}

export function StakeholderQaScreen(props: Props) {
  const { state } = props
  const [tab, setTab] = useState<QaTab>(() => defaultTab(state))
  const hasTextSource = Boolean(state.requirementsText.trim())
  const fileOnlySource = Boolean(state.requirementFileName && !hasTextSource)
  const wordingConfirmed = state.groomConfirmed || fileOnlySource
  const canClarify =
    hasTextSource &&
    Boolean(props.onAsk && props.onPick && props.onOther && props.onToggleOther && props.onUseWording && props.onStartOver)
  const canUseStakeholderWorkflow = wordingConfirmed
  /** Tickets only after stakeholders confirmed (G-GROOM). */
  const canPlanTickets = wordingConfirmed && Boolean(state.groomAcknowledged)

  useEffect(() => {
    if (shouldAutoRunGroomingLoop(state) && !state.groomAcknowledged) setTab('stakeholders')
  }, [state.questions, state.responses, state.groomRejectPending, state.groomAcknowledged])

  useEffect(() => {
    if (hasTextSource && !state.groomConfirmed) setTab('clarify')
  }, [hasTextSource, state.groomConfirmed])

  useEffect(() => {
    if (state.groomConfirmed && !state.groomAcknowledged) setTab('stakeholders')
  }, [state.groomConfirmed, state.groomAcknowledged])

  useEffect(() => {
    if (state.groomAcknowledged && !scopeConfirmed(state)) setTab('tickets')
  }, [state.groomAcknowledged, state.productScope?.confirmationDigest, state.sdlcStartIssueId])

  useEffect(() => {
    if (tab !== 'clarify' || !canClarify || props.grooming) return
    if (
      shouldAutoStartClarify({
        hasPaste: hasTextSource,
        questionCount: state.groomQuestions.length,
        groomStatus: state.groomStatus,
      })
    ) {
      props.onAsk?.()
    }
  }, [tab, canClarify, props.grooming, props.onAsk, hasTextSource, state.groomQuestions.length, state.groomStatus])

  const activeIndex = QA_STEPS.findIndex((step) => step.id === tab)
  const copy = QA_STEPS[activeIndex] || QA_STEPS[0]
  const stepEnabled = (id: QaTab) => {
    if (id === 'clarify') return true
    if (id === 'stakeholders') return canUseStakeholderWorkflow
    return canPlanTickets
  }
  const stepDone = (id: QaTab) => {
    if (id === 'clarify') return wordingConfirmed
    if (id === 'stakeholders') return Boolean(state.groomAcknowledged)
    return scopeConfirmed(state) && Boolean(state.sdlcStartIssueId)
  }

  return (
    <div className="screen stakeholder-qa">
      <div className="screen-header">
        <h2>{copy.title}</h2>
        <p>{copy.detail}</p>
      </div>

      <ol className="ship-stepper" aria-label="Stakeholder Q and A phases">
        {QA_STEPS.map((step, index) => {
          const enabled = stepEnabled(step.id)
          const active = step.id === tab
          const done = !active && (index < activeIndex || stepDone(step.id))
          return (
            <li key={step.id} className={active ? 'is-active' : done ? 'is-done' : ''}>
              <button
                type="button"
                aria-current={active ? 'step' : undefined}
                disabled={!enabled}
                title={
                  enabled
                    ? undefined
                    : step.id === 'tickets'
                      ? 'Acknowledge G-GROOM on Stakeholders first'
                      : 'Confirm wording on Clarify first'
                }
                onClick={() => enabled && setTab(step.id)}
              >
                <span className="ship-step-index">{index + 1}</span>
                <span className="ship-step-label">{step.label}</span>
              </button>
            </li>
          )
        })}
      </ol>

      <div className="ship-substage-panel">
        {tab === 'clarify' ? (
          <div className="req-tickets">
            {canClarify ? (
              <section className="card shape-section">
                <GroomingPanel
                  state={state}
                  loading={Boolean(props.grooming)}
                  onPick={props.onPick!}
                  onOther={props.onOther!}
                  onToggleOther={props.onToggleOther!}
                  onUseWording={props.onUseWording!}
                  onAsk={props.onAsk}
                  onStartOver={props.onStartOver!}
                  onUpdate={props.onUpdate}
                  onNavigate={props.onNavigate}
                  showJiraPanel={false}
                />
              </section>
            ) : (
              <section className="card shape-section">
                <div className="empty-state-block">
                  <h3>No requirement text yet</h3>
                  <p className="muted">Add a requirement on the Requirements step before clarifying it.</p>
                  {props.onNavigate ? (
                    <button type="button" className="secondary-btn" onClick={() => props.onNavigate?.('requirements')}>
                      Open Requirements
                    </button>
                  ) : null}
                </div>
              </section>
            )}
            {wordingConfirmed ? (
              <p className="status-banner info">
                Wording confirmed. Continue to Stakeholders, then Scope &amp; tickets.
              </p>
            ) : null}
          </div>
        ) : null}

        {tab === 'stakeholders' ? (
          <div className="req-tickets stakeholder-merged">
            <p className="muted small" style={{ marginBottom: '0.75rem' }}>
              1) Send leftover questions by email or Jira · 2) Resolve answers below · 3) Acknowledge G-GROOM
            </p>
            <StakeholderQuestionsScreen
              embedded
              state={props.state}
              onUpdate={props.onUpdate}
              onSendOne={props.onSendOne}
              onSendAll={props.onSendAll}
              onPostJira={props.onPostJira}
              onPostAllJira={props.onPostAllJira}
              onRefreshJira={props.onRefreshJira}
              onNavigate={props.onNavigate}
              sending={props.sending}
              posting={props.posting}
              refreshing={props.refreshing}
            />
            <StakeholderResponsesScreen
              embedded
              state={props.state}
              onUpdate={props.onUpdate}
              onSimulateResponses={props.onSimulateResponses}
              onResetSimulatedReplies={props.onResetSimulatedReplies}
              onRefreshJira={() => void props.onRefreshJira()}
              onUpdateResponse={props.onUpdateResponse}
              onResolveAllLatest={props.onResolveAllLatest}
              onPatchQuestion={props.onPatchQuestion}
              refreshing={props.refreshing}
              simulating={props.simulating}
              resetting={props.resetting}
              onOpenTickets={() => {
                if (canPlanTickets) setTab('tickets')
              }}
            />
          </div>
        ) : null}

        {tab === 'tickets' ? (
          <div className="req-tickets">
            {canPlanTickets ? (
              <>
                <DesignOptionsPanel state={state} onUpdate={props.onUpdate} onNavigate={props.onNavigate} />
                <JiraScopePanel
                  state={state}
                  onUpdate={props.onUpdate}
                  sourceText={state.groomDraft || state.requirementsText}
                  jiraPublish={props.jiraPublish}
                  allowAutoPlan
                />
                <ScopeStartStatus state={state} onUpdate={props.onUpdate} />
              </>
            ) : (
              <section className="card shape-section">
                <div className="empty-state-block">
                  <h3>Tickets unlock after G-GROOM</h3>
                  <p className="muted">
                    Finish Stakeholders first, then acknowledge G-GROOM so epics match stakeholder answers.
                  </p>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setTab(wordingConfirmed ? 'stakeholders' : 'clarify')}
                  >
                    {wordingConfirmed ? 'Go to Stakeholders' : 'Go to Clarify'}
                  </button>
                </div>
              </section>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function validateStakeholderQa(state: WizardState): string | null {
  const hasTextSource = Boolean(state.requirementsText.trim())
  const fileOnlySource = Boolean(state.requirementFileName && !hasTextSource)
  if (hasTextSource && !state.groomConfirmed) {
    return 'Confirm the clearer wording on Clarify before continuing.'
  }
  if (!hasTextSource && !fileOnlySource) {
    return 'Add a requirement before continuing.'
  }
  // Stakeholders confirm first — then tickets.
  const outbound = validateStakeholderQuestions(state)
  if (outbound) return outbound
  const responses = validateStakeholderResponses(state)
  if (responses) return responses
  if (state.groomRejectPending && !state.groomingRevision) {
    return 'G-GROOM was rejected — wait for grooming to refresh, then acknowledge again.'
  }
  if (!state.groomAcknowledged) {
    return 'Acknowledge G-GROOM on Stakeholders before Scope & tickets.'
  }
  const scope = validateSdlcScope(state)
  if (scope) return scope
  return null
}

export { jiraCommentForQuestion }
