import { useEffect, useMemo, useState } from 'react'
import { Inbox, Send } from 'lucide-react'
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

type QaTab = 'compose' | 'inbox'

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
  sending?: boolean
  posting?: boolean
  refreshing?: boolean
  simulating?: boolean
  resetting?: boolean
}

function defaultTab(state: WizardState): QaTab {
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

/** Single wizard step: compose/send clarifications and resolve answers + grooming. */
export function StakeholderQaScreen(props: Props) {
  const { state } = props
  const [tab, setTab] = useState<QaTab>(() => defaultTab(state))

  useEffect(() => {
    if (shouldAutoRunGroomingLoop(state)) setTab('inbox')
  }, [state.questions, state.responses, state.groomRejectPending])

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
        <p>Send questions, collect replies, and resolve answers.</p>
      </div>

      <div className="qa-summary-strip">
        <div>
          <strong>
            {stats.outbound}/{stats.total || 0}
          </strong>
          <span>Sent / handled</span>
        </div>
        <div>
          <strong>
            {stats.resolved}/{stats.mandatory || 0}
          </strong>
          <span>Mandatory resolved</span>
        </div>
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
      ) : (
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
      )}
    </div>
  )
}

export function validateStakeholderQa(state: WizardState): string | null {
  const outbound = validateStakeholderQuestions(state)
  if (outbound) return outbound
  const responses = validateStakeholderResponses(state)
  if (responses) return responses
  if (state.groomRejectPending && !state.groomingRevision) {
    return 'G-GROOM was rejected — wait for grooming to refresh, then acknowledge again.'
  }
  if (!state.groomAcknowledged) {
    return 'Acknowledge G-GROOM before continuing to Project Shape.'
  }
  return null
}

export { jiraCommentForQuestion }
