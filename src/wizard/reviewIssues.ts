import type { WizardState, WizardStep } from './types'

export interface ReviewIssue {
  id: string
  type: 'error' | 'warn' | 'info'
  label: string
  targetStep: WizardStep
  details: string[]
}

export function buildReviewIssues(state: WizardState): ReviewIssue[] {
  const issues: ReviewIssue[] = []

  const missingStakeholders = state.stakeholderAssignments.filter(
    (a) => !a.personName.trim() || !a.personEmail.trim(),
  )
  const unsentQuestions = state.questions.filter((q) => !q.sent)
  const pendingMandatory = state.questions.filter(
    (q) => {
      const response = state.responses.find((r) => r.questionId === q.id)
      const text = response?.response?.trim() || q.jiraReplyBody?.trim()
      return q.mandatory && !(response?.status === 'answered' && text)
    },
  )
  const disconnectedIntegrations = state.integrations.filter((i) => !i.connected)

  const missingDetails: string[] = []
  if (missingStakeholders.length) {
    missingDetails.push(`${missingStakeholders.length} stakeholder(s) missing name or email`)
  }
  if (unsentQuestions.length) {
    missingDetails.push(`${unsentQuestions.length} stakeholder question(s) not sent`)
  }
  if (pendingMandatory.length) {
    missingDetails.push(`${pendingMandatory.length} mandatory response(s) still pending`)
  }
  if (!state.requirementsText.trim() && !state.requirementFileName) {
    missingDetails.push('Requirements not provided yet')
  } else if (state.requirementsText.trim() && !state.groomConfirmed) {
    missingDetails.push('Requirement wording not confirmed yet')
  } else if (!state.requirementsAnalyzed) {
    missingDetails.push('Requirements not analyzed yet')
  }
  if (disconnectedIntegrations.length > 3) {
    missingDetails.push(`${disconnectedIntegrations.length} integrations not connected`)
  }

  if (missingDetails.length > 0) {
    issues.push({
      id: 'missing',
      type: 'error',
      label: `${missingDetails.length} Missing decision${missingDetails.length > 1 ? 's' : ''}`,
      targetStep: missingStakeholders.length
        ? 'project-stakeholders'
        : unsentQuestions.length || pendingMandatory.length
          ? 'stakeholder-qa'
          : state.requirementsText.trim() && !state.groomConfirmed
              ? 'stakeholder-qa'
              : !state.requirementsAnalyzed
                ? 'stakeholder-qa'
                : 'integrations',
      details: missingDetails,
    })
  }

  const tbdTech = state.repoTechnologies.filter((t) => t.status === 'tbd')
  const recommendedTech = state.repoTechnologies.filter((t) => t.status === 'recommendation')
  if (tbdTech.length > 0) {
    issues.push({
      id: 'tbd',
      type: 'warn',
      label: `${tbdTech.length} TBD technolog${tbdTech.length > 1 ? 'ies' : 'y'}`,
      targetStep: 'technology-per-repo',
      details: tbdTech.map((t) => {
        const repo = state.repositories.find((r) => r.id === t.repoId)
        return `${repo?.name ?? t.repoId}: technology stack marked TBD`
      }),
    })
  } else if (recommendedTech.length > 0) {
    issues.push({
      id: 'tbd',
      type: 'info',
      label: `${recommendedTech.length} recommendation${recommendedTech.length > 1 ? 's' : ''} to confirm`,
      targetStep: 'technology-per-repo',
      details: recommendedTech.map((t) => {
        const repo = state.repositories.find((r) => r.id === t.repoId)
        return `${repo?.name ?? t.repoId}: ${t.language} / ${t.framework}`
      }),
    })
  }

  const archDetails: string[] = []
  if (state.architectureStyle === 'microservices' && state.repositories.length < 3) {
    archDetails.push('Microservices selected but fewer than 3 repositories defined')
  }
  if (state.repositoryModel === 'multi-repo' && state.repositories.length < 2) {
    archDetails.push('Multi-repo model requires at least 2 repositories')
  }
  if (!state.cloudProvider) {
    archDetails.push('Cloud provider not configured')
  }
  if (!state.repositories.some((r) => r.name.trim())) {
    archDetails.push('No repositories defined yet')
  }
  if (archDetails.length > 0) {
    issues.push({
      id: 'arch',
      type: 'warn',
      label: `${archDetails.length} architecture issue${archDetails.length > 1 ? 's' : ''}`,
      targetStep: 'project-shape',
      details: archDetails,
    })
  }

  return issues
}
