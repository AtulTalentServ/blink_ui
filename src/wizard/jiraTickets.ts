import {
  createJiraIssues,
  planProductScope,
  streamCreateJiraIssues,
  streamPlanProductScope,
  type CreateJiraIssuesPayload,
  type JiraCreatedIssueResult,
} from '../api/blink'
import type { JiraCreatedIssue, ProductScopeData, WizardState } from './types'

let ticketsPipelineBusy = false
let jiraCreateBusy = false

export function markTicketsPipelineBusy(busy: boolean) {
  ticketsPipelineBusy = busy
}

export function isTicketsPipelineBusy() {
  return ticketsPipelineBusy
}

export function beginJiraCreate(): boolean {
  if (jiraCreateBusy) return false
  jiraCreateBusy = true
  markTicketsPipelineBusy(true)
  return true
}

export function endJiraCreate() {
  jiraCreateBusy = false
  markTicketsPipelineBusy(false)
}

export function isJiraCreateBusy() {
  return jiraCreateBusy
}

export function jiraConnection(state: WizardState) {
  return state.integrations.find((item) => item.id === 'jira')
}

export function isJiraReady(state: WizardState): boolean {
  const jira = jiraConnection(state)
  return Boolean(state.projectId && jira?.connected && jira.projectKey)
}

/** Shown when tickets likely exist in Jira but this screen no longer has the keys. */
export const JIRA_CREATE_KEYS_LOST =
  'Jira created the tickets but this screen lost the issue keys. Check the Jira project before creating again.'

export function isLostJiraCreateKeys(item: JiraCreatedIssue | undefined): boolean {
  return Boolean(item?.message && item.message === JIRA_CREATE_KEYS_LOST)
}

export function issuesFromBlinkJiraList(
  issues: Array<{
    key?: string
    sourceId?: string
    url?: string
    type?: string
    issueType?: string
    sourceKind?: string
  }>,
): JiraCreatedIssue[] {
  const map = new Map<string, JiraCreatedIssue>()
  const sorted = [...issues].sort((a, b) =>
    (a.key || '').localeCompare(b.key || '', undefined, { numeric: true }),
  )
  for (const row of sorted) {
    if (!row.sourceId || !row.key) continue
    map.set(row.sourceId, {
      sourceId: row.sourceId,
      jiraKey: row.key,
      jiraUrl: row.url,
      url: row.url,
      type: row.issueType || row.type || (row.sourceKind === 'epic' ? 'Epic' : 'Story'),
      status: 'created',
    })
  }
  return [...map.values()]
}

function jiraCreatedRank(item: { status?: string; jiraKey?: string | null }): number {
  if (item.jiraKey && item.status === 'created') return 4
  if (item.jiraKey) return 3
  if (item.status === 'failed') return 2
  if (item.status === 'creating') return 1
  return 0
}

function isResolvedJiraRow(item: JiraCreatedIssue | undefined): boolean {
  if (!item?.sourceId) return false
  if (item.status === 'created' || Boolean(item.jiraKey)) return true
  return isLostJiraCreateKeys(item)
}

export function pendingJiraTicketCount(state: WizardState): number {
  const resolved = new Set(
    (state.jiraCreatedIssues || [])
      .filter((item) => isResolvedJiraRow(item))
      .map((item) => item.sourceId as string),
  )
  const epics = state.productScope?.epics || []
  const stories = state.productScope?.stories || []
  return [...epics, ...stories].filter((item) => item.id && !resolved.has(item.id)).length
}

export function mergeJiraCreatedIssues(
  current: JiraCreatedIssue[] | undefined,
  incoming: Array<JiraCreatedIssue | JiraCreatedIssueResult>,
): JiraCreatedIssue[] {
  const map = new Map<string, JiraCreatedIssue>()
  for (const item of current || []) {
    if (item.sourceId) map.set(item.sourceId, item)
  }
  for (const item of incoming) {
    const sourceId = item.sourceId
    if (!sourceId) continue
    const next: JiraCreatedIssue = {
      sourceId,
      jiraKey: item.jiraKey,
      jiraUrl: item.jiraUrl || item.url,
      url: item.url,
      type: item.type,
      status: item.status,
      message: item.message,
    }
    const existing = map.get(sourceId)
    if (existing && jiraCreatedRank(existing) > jiraCreatedRank(next)) continue
    map.set(sourceId, next)
  }
  return [...map.values()]
}

export function failCreatingJiraIssues(
  current: JiraCreatedIssue[] | undefined,
  message: string,
  extras: Array<JiraCreatedIssue | JiraCreatedIssueResult> = [],
): JiraCreatedIssue[] {
  const resolved = new Set(
    extras.filter((item) => item.status === 'created' && item.sourceId).map((item) => item.sourceId as string),
  )
  const failed = (current || [])
    .filter((item) => item.status === 'creating' && item.sourceId && !resolved.has(item.sourceId))
    .map((item) => ({
      ...item,
      status: 'failed' as const,
      message,
    }))
  return mergeJiraCreatedIssues(current, [...extras, ...failed])
}

export function dropJiraCreatedIssues(
  current: JiraCreatedIssue[] | undefined,
  sourceIds: string[],
): JiraCreatedIssue[] {
  const drop = new Set(sourceIds)
  return (current || []).filter((item) => !item.sourceId || !drop.has(item.sourceId))
}

/** Tickets created in Jira for epics/stories currently listed on the product-scope screen. */
export function createdTicketsOnScreen(state: WizardState): JiraCreatedIssue[] {
  const onScreen = new Set([
    ...(state.productScope?.epics || []).map((item) => item.id),
    ...(state.productScope?.stories || []).map((item) => item.id),
  ])
  return (state.jiraCreatedIssues || []).filter(
    (item) =>
      item.status === 'created' &&
      Boolean(item.jiraKey) &&
      Boolean(item.sourceId) &&
      onScreen.has(item.sourceId as string),
  )
}

/** Jira keys for this screen only — stories first so epics are not deleted while their children remain. */
export function jiraKeysCreatedOnScreen(state: WizardState): string[] {
  const created = createdTicketsOnScreen(state)
  const epicIds = new Set((state.productScope?.epics || []).map((item) => item.id))
  const stories = created.filter((item) => !epicIds.has(item.sourceId as string))
  const epics = created.filter((item) => epicIds.has(item.sourceId as string))
  return [...stories, ...epics].map((item) => item.jiraKey as string)
}

export function idsForEpicRemoval(scope: ProductScopeData | null | undefined, epicId: string): string[] {
  const epic = scope?.epics?.find((item) => item.id === epicId)
  const childIds = (scope?.stories || [])
    .filter((story) => story.epicId === epicId || epic?.storyIds?.includes(story.id))
    .map((story) => story.id)
  return [epicId, ...childIds]
}

export function removePlannedTickets(
  scope: ProductScopeData | null | undefined,
  sourceIds: string[],
  opts?: { keepOrphanStories?: boolean },
): ProductScopeData | null {
  if (!scope) return null
  const drop = new Set(sourceIds)
  const epics = (scope.epics || [])
    .filter((epic) => !drop.has(epic.id))
    .map((epic) => ({
      ...epic,
      storyIds: epic.storyIds?.filter((id) => !drop.has(id)),
    }))
  const remainingEpicIds = new Set(epics.map((epic) => epic.id))
  const stories = (scope.stories || [])
    .filter((story) => {
      if (drop.has(story.id)) return false
      if (opts?.keepOrphanStories) return true
      return !story.epicId || !drop.has(story.epicId)
    })
    .map((story) => {
      if (!opts?.keepOrphanStories) return story
      if (story.epicId && !remainingEpicIds.has(story.epicId)) {
        return { ...story, epicId: undefined }
      }
      return story
    })
  return {
    ...scope,
    epics,
    stories,
    epicIds: epics.map((epic) => epic.id),
    storyIds: stories.map((story) => story.id),
  }
}

export function toCreateJiraPayload(
  state: WizardState,
  opts?: { pendingOnly?: boolean },
): CreateJiraIssuesPayload | null {
  const jira = jiraConnection(state)
  if (!state.projectId || !jira?.connected || !jira.projectKey) return null
  const createdBySource = new Map(
    (state.jiraCreatedIssues || []).filter((item) => item.sourceId).map((item) => [item.sourceId as string, item]),
  )
  let epics = state.productScope?.epics || []
  let stories = state.productScope?.stories || []
  if (opts?.pendingOnly) {
    epics = epics.filter((epic) => !isResolvedJiraRow(createdBySource.get(epic.id)))
    stories = stories.filter((story) => !isResolvedJiraRow(createdBySource.get(story.id)))
  }
  if (epics.length === 0 && stories.length === 0) return null
  return {
    projectId: state.projectId,
    projectKey: jira.projectKey,
    epics: epics.map((epic) => ({
      id: epic.id,
      title: epic.title,
      objective: epic.objective,
      storyIds: epic.storyIds,
    })),
    stories: stories.map((story) => {
      const epicId = story.epicId || epics.find((epic) => epic.storyIds?.includes(story.id))?.id
      const parent = epicId ? createdBySource.get(epicId) : undefined
      return {
        id: story.id,
        epicId,
        epicKey: parent?.jiraKey || undefined,
        title: story.title,
        objective: story.objective,
        asA: story.asA,
        iWant: story.iWant,
        soThat: story.soThat,
        acceptanceCriteria: story.acceptanceCriteria,
      }
    }),
  }
}

export type PlanScopeOptions = {
  productScope?: WizardState['productScope']
  refresh?: boolean
}

export async function planScopeFromWording(
  state: WizardState,
  requirementText: string,
  onThinking?: (text: string) => void,
  opts?: PlanScopeOptions,
): Promise<Partial<WizardState>> {
  const wording = requirementText.trim()
  if (!wording) {
    throw new Error('Add a cleared requirement first so Blink can propose epics and stories.')
  }
  const payload = {
    projectName: state.projectName,
    requirementText: wording,
    actor: 'operator',
    refresh: opts?.refresh,
    productScope: opts?.productScope ?? undefined,
  }
  const scopeRes = onThinking
    ? await streamPlanProductScope(state.projectId, payload, { onThinking })
    : await planProductScope(state.projectId, payload)
  if (scopeRes?.status === 'ok' && scopeRes.productScope) {
    const patch: Partial<WizardState> = {
      productScope: scopeRes.productScope,
      scopeDigest: scopeRes.proposalDigest,
      scopeOverlays: scopeRes.overlayFiles || [],
      workClassification: null,
      specification: null,
      technicalPlan: null,
      nextSdlcCommand: scopeRes.nextCommand || '/confirm-product-scope',
      scopeQuestions: [],
      scopeAnswers: [],
      scopeClarifyStatus: 'draft_ready',
    }
    return patch
  }
  throw new Error(scopeRes?.message || 'Product scope planning did not return epics yet.')
}

export async function createJiraIssuesFromState(
  state: WizardState,
  handlers?: {
    pendingOnly?: boolean
    onStart?: (total: number) => void
    onItem?: (issue: JiraCreatedIssue) => void
  },
) {
  const payload = toCreateJiraPayload(state, { pendingOnly: handlers?.pendingOnly })
  if (!payload) {
    throw new Error('Connect Atlassian and choose a Jira project on Integrations first.')
  }
  const result = handlers
    ? await streamCreateJiraIssues(payload, {
        onStart: (total) => handlers.onStart?.(total),
        onItem: (issue) => handlers.onItem?.(issue),
      })
    : await createJiraIssues(payload)
  return {
    issues: result.issues || [],
    status: result.status,
    message: result.message,
  }
}
