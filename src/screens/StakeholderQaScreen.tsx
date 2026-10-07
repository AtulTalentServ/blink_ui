import { useEffect, useMemo, useRef, useState } from 'react'
import { Inbox, Send, Ticket } from 'lucide-react'
import { configureStakeholders, confirmStakeholders } from '../api/blink'
import {
  StakeholderQuestionsScreen,
  jiraCommentForQuestion,
  validateStakeholderQuestions,
} from './StakeholderQuestionsScreen'
import { validateProjectStakeholders } from './ProjectStakeholdersScreen'
import {
  StakeholderResponsesScreen,
  shouldAutoRunGroomingLoop,
  validateStakeholderResponses,
} from './StakeholderResponsesScreen'
import { DesignOptionsPanel } from './DesignOptionsPanel'
import { JiraScopePanel } from './JiraScopePanel'
import { ScopeStartStatus, validateSdlcScope } from './SdlcPlanningScreen'
import { RequirementRevisionPanel } from './RequirementRevisionPanel'
import type { QuestionResponse, StakeholderQuestion, WizardState, WizardStep } from '../wizard/types'
import type { JiraPublishState } from '../wizard/thinking'

type QaTab = 'compose' | 'inbox' | 'scope'

interface Props {
  state: WizardState
  onUpdate: (patch: Partial<WizardState>) => void
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
  jiraPublish?: JiraPublishState | null
  sending?: boolean
  posting?: boolean
  refreshing?: boolean
  simulating?: boolean
  resetting?: boolean
}

function confirmationReady(state: WizardState): boolean {
  if (!state.stakeholdersConfirmed) return false
  if (!state.groomConfirmed) return false
  if (state.groomRejectPending && !state.groomingRevision) return false
  if (!state.groomAcknowledged) return false
  if (validateStakeholderQuestions(state)) return false
  if (validateStakeholderResponses(state)) return false
  return true
}

function defaultTab(state: WizardState): QaTab {
  if (confirmationReady(state)) return 'scope'
  if (shouldAutoRunGroomingLoop(state)) return 'inbox'
  const hasOutbound = state.questions.some(
    (q) =>
      q.sent ||
      ((q.jiraCommentStatus === 'posted' || q.jiraCommentStatus === 'replied' || q.jiraCommentStatus === 'discussion') &&
        Boolean(q.jiraCommentId)),
  )
  const hasAnswers = state.responses.some((r) => r.status === 'answered' && r.response.trim())
  if (hasOutbound || hasAnswers || state.questionsSent) return 'inbox'
  return 'compose'
}

/** Compose/send clarifications, resolve answers, then propose epics after confirmation. */
export function StakeholderQaScreen(props: Props) {
  const { state, onUpdate } = props
  const [tab, setTab] = useState<QaTab>(() => defaultTab(state))
  const scopeUnlocked = confirmationReady(state)
  const wording = (state.groomDraft || state.requirementsText).trim()
  const autoConfirmRef = useRef(false)

  // Don't bounce users back to Project & Stakeholders — confirm the roster here if needed.
  useEffect(() => {
    if (autoConfirmRef.current || state.stakeholdersConfirmed) return
    if (validateProjectStakeholders(state)) return
    if (!state.projectId) return
    autoConfirmRef.current = true
    onUpdate({ stakeholdersConfirmed: true })
    const projectId = state.projectId
    void configureStakeholders(projectId).catch(() => undefined)
    void confirmStakeholders(projectId)
      .then((res) => {
        if (res.status === 'ok') {
          onUpdate({
            stakeholdersConfirmed: true,
            stakeholdersConfirmationDigest: res.confirmationDigest || null,
            nextSdlcCommand: res.nextCommand || state.nextSdlcCommand,
          })
        }
      })
      .catch(() => {
        autoConfirmRef.current = false
        onUpdate({ stakeholdersConfirmed: false })
      })
  }, [state, onUpdate])

  useEffect(() => {
    if (shouldAutoRunGroomingLoop(state)) setTab('inbox')
  }, [state.questions, state.responses, state.groomRejectPending])

  useEffect(() => {
    if (scopeUnlocked && tab !== 'scope') {
      // Keep the operator on inbox until they open Scope; do not force-jump.
    }
  }, [scopeUnlocked, tab])

  const stats = useMemo(() => {
    const total = state.questions.length
    const outbound = state.questions.filter((q) => {
      const emailed = q.sent
      const jiraDone =
        (q.jiraCommentStatus === 'posted' || q.jiraCommentStatus === 'replied') && Boolean(q.jiraCommentId)
      const answered = state.responses.find((r) => r.questionId === q.id)?.status === 'answered'
      return emailed || jiraDone || answered
    }).length
    const mandatory = state.questions.filter((q) => q.mandatory)
    const resolved = mandatory.filter((q) => {
      const response = state.responses.find((r) => r.questionId === q.id)
      const text = response?.response?.trim() || q.jiraReplyBody?.trim()
      return response?.status === 'answered' && Boolean(text)
    }).length
    return { total, outbound, mandatory: mandatory.length, resolved }
  }, [state.questions, state.responses])

  return (
    <div className="screen stakeholder-qa">
      <div className="screen-header">
        <h2>Stakeholder Q&amp;A</h2>
        <p>
          Send leftover questions, collect answers, then open Scope &amp; tickets for epics.
        </p>
      </div>

      <div className="tab-row qa-tabs" role="tablist" aria-label="Stakeholder Q and A">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'compose'}
          className={`tab-btn ${tab === 'compose' ? 'active' : ''}`}
          onClick={() => setTab('compose')}
        >
          <Send size={14} /> Compose &amp; send
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'inbox'}
          className={`tab-btn ${tab === 'inbox' ? 'active' : ''}`}
          onClick={() => setTab('inbox')}
        >
          <Inbox size={14} /> Inbox &amp; grooming
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'scope'}
          className={`tab-btn ${tab === 'scope' ? 'active' : ''}`}
          disabled={!scopeUnlocked}
          title={scopeUnlocked ? undefined : 'Acknowledge G-GROOM after stakeholder answers first'}
          onClick={() => scopeUnlocked && setTab('scope')}
        >
          <Ticket size={14} /> Scope &amp; tickets
        </button>
      </div>

      {tab === 'compose' ? (
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
      ) : null}

      {tab === 'inbox' ? (
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
        />
      ) : null}

      {tab === 'scope' ? (
        <div className="req-tickets">
          <p className="status-banner success">
            Stakeholders confirmed. Propose epics from the cleared wording, confirm product scope, then create Jira
            tickets.
          </p>
          <DesignOptionsPanel state={state} onUpdate={props.onUpdate} onNavigate={props.onNavigate} />
          <JiraScopePanel
            state={state}
            onUpdate={props.onUpdate}
            sourceText={wording}
            jiraPublish={props.jiraPublish}
            allowAutoPlan
          />
          <ScopeStartStatus state={state} onUpdate={props.onUpdate} />
          <RequirementRevisionPanel projectId={state.projectId} />
          {!state.integrations.find((item) => item.id === 'jira')?.connected && props.onNavigate ? (
            <p className="groom-blocker-hint">
              Connect Atlassian to create tickets.{' '}
              <button type="button" className="text-btn" onClick={() => props.onNavigate?.('integrations')}>
                Open Integrations
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function validateStakeholderQa(state: WizardState): string | null {
  if (!state.stakeholdersConfirmed && validateProjectStakeholders(state)) {
    return 'Add project name, description, and at least one stakeholder before continuing.'
  }
  const outbound = validateStakeholderQuestions(state)
  if (outbound) return outbound
  const responses = validateStakeholderResponses(state)
  if (responses) return responses
  if (state.groomRejectPending && !state.groomingRevision) {
    return 'G-GROOM was rejected — wait for grooming to refresh, then acknowledge again.'
  }
  if (!state.groomAcknowledged) {
    return 'Acknowledge G-GROOM after stakeholder answers before proposing epics.'
  }
  return validateSdlcScope(state)
}

export { jiraCommentForQuestion }
