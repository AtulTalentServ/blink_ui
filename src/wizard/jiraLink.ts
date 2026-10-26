export interface LinkedJiraIssue {
  sourceId?: string
  jiraKey?: string | null
  jiraUrl?: string | null
  url?: string | null
  type?: string
  status?: string
  message?: string
}

export interface BlinkMarkedJiraIssue {
  key?: string
  sourceId?: string
  url?: string
  type?: string
  issueType?: string
  sourceKind?: string
  summary?: string
}

/** Jira summaries are capped at 240 characters when Blink creates the issue. */
const JIRA_SUMMARY_LIMIT = 240

export function normalizeTicketTitle(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** True when a Jira issue summary is the planned epic/story title, not an older ticket that reused the source id. */
export function ticketTitlesMatch(plannedTitle: string, jiraSummary: string | null | undefined): boolean {
  const planned = normalizeTicketTitle(plannedTitle)
  const summary = normalizeTicketTitle(jiraSummary)
  if (!planned || !summary) return false
  if (planned === summary) return true
  if (planned.length > JIRA_SUMMARY_LIMIT && planned.slice(0, JIRA_SUMMARY_LIMIT) === summary) return true
  return false
}

export interface PlannedJiraScope {
  epics?: Array<{ id: string; title?: string }>
  stories?: Array<{ id: string; title?: string }>
}

function plannedTitleById(scope: PlannedJiraScope): Map<string, string> {
  const titles = new Map<string, string>()
  for (const item of [...(scope.epics || []), ...(scope.stories || [])]) {
    if (item.id) titles.set(item.id, item.title || '')
  }
  return titles
}

function jiraIssueSignature(items: LinkedJiraIssue[]): string {
  return items
    .map((item) => [item.sourceId || '', item.status || '', item.jiraKey || '', item.message || ''].join('\t'))
    .sort()
    .join('\n')
}

function jiraCreatedRank(item: { status?: string; jiraKey?: string | null }): number {
  if (item.jiraKey && item.status === 'created') return 4
  if (item.jiraKey) return 3
  if (item.status === 'failed') return 2
  if (item.status === 'creating') return 1
  return 0
}

function mergeLinks(current: LinkedJiraIssue[], incoming: LinkedJiraIssue[]): LinkedJiraIssue[] {
  const map = new Map<string, LinkedJiraIssue>()
  for (const item of current) {
    if (item.sourceId) map.set(item.sourceId, item)
  }
  for (const item of incoming) {
    if (!item.sourceId) continue
    const existing = map.get(item.sourceId)
    if (existing && jiraCreatedRank(existing) > jiraCreatedRank(item)) continue
    map.set(item.sourceId, item)
  }
  return [...map.values()]
}

/**
 * Product-scope ids (`PRODUCT-E001`) are reused every time the same project is planned.
 * Older Jira issues still carry `Source epic:` / `Source story:` for those ids.
 * A stored key is kept only when that issue's summary is the title on screen now.
 * A key whose live summary is a different ticket is dropped so Create posts a new issue.
 * Historical issues are not attached to tickets that have no key yet (`recover` defaults off).
 */
export function reconcileBlinkJiraLinks(
  current: LinkedJiraIssue[] | undefined,
  listed: BlinkMarkedJiraIssue[],
  scope: PlannedJiraScope,
  opts?: { recover?: boolean },
): { issues: LinkedJiraIssue[]; changed: boolean } {
  const titles = plannedTitleById(scope)
  const byKey = new Map<string, BlinkMarkedJiraIssue>()
  const bySource = new Map<string, BlinkMarkedJiraIssue[]>()
  for (const row of listed) {
    if (!row.key || !row.sourceId) continue
    byKey.set(row.key, row)
    const bucket = bySource.get(row.sourceId) || []
    bucket.push(row)
    bySource.set(row.sourceId, bucket)
  }

  const stale = new Set<string>()
  for (const item of current || []) {
    if (!item.sourceId || !item.jiraKey || item.status !== 'created') continue
    if (!titles.has(item.sourceId)) continue
    const live = byKey.get(item.jiraKey)
    if (!live || !normalizeTicketTitle(live.summary)) continue
    if (!ticketTitlesMatch(titles.get(item.sourceId) || '', live.summary)) stale.add(item.sourceId)
  }

  const kept = (current || []).filter((item) => !item.sourceId || !stale.has(item.sourceId))
  const keptCreated = new Set(
    kept
      .filter((item) => item.status === 'created' && item.jiraKey && item.sourceId)
      .map((item) => item.sourceId as string),
  )

  const recovered: LinkedJiraIssue[] = []
  if (opts?.recover) {
    for (const [sourceId, planned] of titles) {
      if (keptCreated.has(sourceId)) continue
      const candidates = (bySource.get(sourceId) || []).filter((row) => ticketTitlesMatch(planned, row.summary))
      if (!candidates.length) continue
      candidates.sort((a, b) => (a.key || '').localeCompare(b.key || '', undefined, { numeric: true }))
      const row = candidates[candidates.length - 1]
      recovered.push({
        sourceId,
        jiraKey: row.key,
        jiraUrl: row.url,
        url: row.url,
        type: row.issueType || row.type || (row.sourceKind === 'epic' ? 'Epic' : 'Story'),
        status: 'created',
      })
    }
  }

  const issues = mergeLinks(kept, recovered)
  return { issues, changed: jiraIssueSignature(current || []) !== jiraIssueSignature(issues) }
}
