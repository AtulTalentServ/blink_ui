import { sanitizeDownloadStructure } from '../wizard/defaults'
import type { DesignOption, ProductScopeData, WizardState } from '../wizard/types'
import { stripExcludedZipFolders } from './stripZipFolders'
import { loadAuthSession } from '../auth/session'
import { CHAT_MODEL_STORAGE_KEY } from '../developer/chatModels'

export interface StakeholderRoleDto {
  roleCode: string
  roleName: string
  description?: string
  required: boolean
  displayOrder?: number
  defaultName?: string
  defaultEmail?: string
}

export interface StakeholderPayload {
  roleCode: string
  name: string
  email: string
}

export interface ProjectPayload {
  projectType: 'new' | 'existing'
  projectName: string
  description: string
  stakeholders: StakeholderPayload[]
  wizardStep?: string
  wizardCompletedThrough?: number
  wizardState?: unknown
}

export interface StakeholderDto {
  id: number
  roleCode: string
  roleName: string
  name: string
  email: string
}

export interface ProjectDto {
  id: number
  projectName: string
  projectCode: string
  description?: string
  status: string
  projectType: 'new' | 'existing'
  stakeholders: StakeholderDto[]
  workspaceKey?: string | null
  workspaceUrl?: string | null
  workspaceStatus?: 'preparing' | 'ready' | 'failed' | null
  sodWarnings?: string[]
  nextCommand?: string
  governanceStatus?: 'idle' | 'preparing' | 'ready' | 'failed' | null
  ownerEmail?: string | null
  wizardStep?: string | null
  wizardCompletedThrough?: number | null
  wizardState?: unknown
  wizardUpdatedAt?: string | null
}

export interface ConfigureStakeholdersResponse {
  status: string
  message: string
  nextCommand: string
  sodWarnings: string[]
  errors: string[]
  rolesConfigured: number
}

async function readError(response: Response): Promise<string> {
  const text = await response.text()
  try {
    const parsed = JSON.parse(text) as { message?: string }
    return parsed.message || text || `Request failed (${response.status})`
  } catch {
    return text || `Request failed (${response.status})`
  }
}

function authHeaders(json = false): HeadersInit {
  const headers: Record<string, string> = {}
  if (json) {
    headers['Content-Type'] = 'application/json'
    headers.Accept = 'application/json'
  }
  const session = loadAuthSession()
  if (session?.token) headers.Authorization = `Bearer ${session.token}`
  try {
    const selectedModel = localStorage.getItem(CHAT_MODEL_STORAGE_KEY)
    if (selectedModel) headers['X-Blink-AI-Model'] = selectedModel
  } catch {
    /* Model selection is optional; requests remain usable if browser storage is unavailable. */
  }
  return headers
}

/** API base. In `npm run dev`, `.env.development` can point at Render or `/api` (Vite proxy). */
const DEFAULT_API_URL = 'https://blink-backend-af7x.onrender.com/api'

export function apiUrl(path: string): string {
  let base = (import.meta.env.VITE_API_URL ?? DEFAULT_API_URL).replace(/\/$/, '')
  if (/^https?:\/\//.test(base) && !base.endsWith('/api')) {
    base = `${base}/api`
  }
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${base}${suffix}`
}

/** Short JSON calls (login, email). Long agent/download calls must keep their own timeouts. */
export async function timedFetch(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timed out. Try again.')
    }
    if (err instanceof TypeError) {
      throw new Error('Could not reach the Blink API.')
    }
    throw err
  } finally {
    window.clearTimeout(timer)
  }
}

/** Absolute OAuth callback GitHub/Atlassian will redirect to (API host after deploy, Vite origin locally). */
export function oauthCallbackUrl(provider: 'github' | 'jira' | 'figma'): string {
  const path = `/integrations/${provider}/oauth/callback`
  const resolved = apiUrl(path)
  if (/^https?:\/\//i.test(resolved)) {
    return canonicalizeOAuthCallback(resolved)
  }
  const prefix = resolved.startsWith('/') ? resolved : `/${resolved}`
  return canonicalizeOAuthCallback(`${window.location.origin}${prefix}`)
}

/** GitHub OAuth apps treat localhost and 127.0.0.1 as different callback URLs. */
export function canonicalizeOAuthCallback(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]' || parsed.hostname === '::1') {
      parsed.hostname = 'localhost'
    }
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return url
  }
}

function isLocalApi(): boolean {
  const base = (import.meta.env.VITE_API_URL ?? DEFAULT_API_URL).replace(/\/$/, '')
  return base.startsWith('/') || /localhost|127\.0\.0\.1/.test(base)
}

function normalizeGroomQuestions(value: unknown): GroomQuestionDto[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const options = Array.isArray(row.options)
      ? row.options.flatMap((opt, optIndex) => {
          if (!opt || typeof opt !== 'object') return []
          const option = opt as Record<string, unknown>
          const label = String(option.label || '').trim()
          const id = String(option.id || '').trim()
          const description = option.description ? String(option.description).trim() : undefined
          if (!label || !id) return []
          return [{ id: id || `opt-${optIndex + 1}`, label, ...(description ? { description } : {}) }]
        })
      : []
    const text = String(row.text || '').trim()
    const id = String(row.id || '').trim()
    const subtitle = row.subtitle ? String(row.subtitle).trim() : undefined
    if (!id || !text || options.length < 2) return []
    const priorityRaw = String(row.priority || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
    const priority =
      priorityRaw === 'important' || priorityRaw === 'suggestion'
        ? priorityRaw
        : row.priority
          ? ('need_clarification' as const)
          : undefined
    const ownerRoleRaw = String(
      row.ownerRole || row.owner_role || row.role || '',
    )
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
    const ownerRole = ownerRoleRaw || undefined
    return [
      {
        id: id || `q-${index + 1}`,
        text,
        ...(subtitle ? { subtitle } : {}),
        options,
        allowOther: row.allowOther !== false,
        allowMultiple: Boolean(row.allowMultiple),
        ...(priority ? { priority } : {}),
        ...(ownerRole ? { ownerRole } : {}),
      },
    ]
  })
}

export async function fetchStakeholderRoles(): Promise<StakeholderRoleDto[]> {
  const url = apiUrl('/stakeholder-roles')
  console.info(`[blink] GET ${url}`)
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<StakeholderRoleDto[]>
}

export async function fetchWorkspaceStatus(projectName: string, projectId?: string | null): Promise<{
  workspaceKey?: string | null
  status?: 'preparing' | 'ready' | 'failed' | null
  filesCopied: number
  filesTotal: number
  percent: number
  exists: boolean
}> {
  const params = new URLSearchParams({ projectName })
  if (projectId) params.set('projectId', projectId)
  const url = apiUrl(`/projects/workspace-status?${params.toString()}`)
  const response = await fetch(url, { cache: 'no-store', headers: authHeaders() })
  if (!response.ok) throw new Error(await readError(response))
  const data = await response.json() as {
    workspaceKey?: string | null
    status?: 'preparing' | 'ready' | 'failed' | null
    workspaceStatus?: 'preparing' | 'ready' | 'failed' | null
    filesCopied?: number
    filesTotal?: number
    percent?: number
    exists?: boolean
  }
  const status = data.status || data.workspaceStatus || null
  const filesCopied = data.filesCopied ?? 0
  const filesTotal = data.filesTotal ?? 0
  const percent = typeof data.percent === 'number'
    ? data.percent
    : status === 'ready'
      ? 100
      : filesTotal > 0
        ? Math.min(99, Math.round((filesCopied * 100) / filesTotal))
        : 0
  return {
    workspaceKey: data.workspaceKey,
    status,
    filesCopied,
    filesTotal,
    percent,
    exists: Boolean(data.exists || status === 'ready'),
  }
}

export interface S3WorkspaceProjectDto {
  folder: string
  projectId?: number | null
  url: string
  objectCount: number
  totalBytes: number
  kitComplete: boolean
}

export interface S3WorkspaceListDto {
  enabled: boolean
  bucket?: string | null
  workspaces: S3WorkspaceProjectDto[]
}

export interface S3WorkspaceDeleteDto {
  deletedFolders: number
  deletedObjects: number
  folders: string[]
}

/** Developer panel: list Blink-owned `*_workspace` folders in the configured S3 bucket. */
export async function fetchS3Workspaces(): Promise<S3WorkspaceListDto> {
  const url = apiUrl('/dev/workspaces')
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 60_000)
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: authHeaders(),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(await readError(response))
    return response.json() as Promise<S3WorkspaceListDto>
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Listing S3 workspaces timed out. Check the API and AWS credentials.')
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

export async function deleteS3Workspace(folder: string): Promise<S3WorkspaceDeleteDto> {
  const url = apiUrl(`/dev/workspaces/${encodeURIComponent(folder)}`)
  const response = await fetch(url, { method: 'DELETE', headers: authHeaders() })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<S3WorkspaceDeleteDto>
}

export async function deleteAllS3Workspaces(): Promise<S3WorkspaceDeleteDto> {
  const url = apiUrl('/dev/workspaces')
  const response = await fetch(url, { method: 'DELETE', headers: authHeaders() })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<S3WorkspaceDeleteDto>
}

export interface BlinkJiraIssueDto {
  key: string
  issueType: string
  summary: string
  sourceKind: 'epic' | 'story' | string
  sourceId: string
  url: string
}

export interface BlinkJiraIssueListDto {
  connected: boolean
  blinkProjectId?: number | null
  jiraProjectKey?: string | null
  browseBase?: string | null
  issues: BlinkJiraIssueDto[]
  message?: string | null
}

export interface BlinkJiraIssueDeleteDto {
  deleted: number
  skipped: number
  deletedKeys: string[]
  skippedKeys: string[]
  errors: string[]
}

/** Developer panel: list Blink-marked Jira issues for the connected Blink project. */
export async function fetchBlinkJiraIssues(projectId: string): Promise<BlinkJiraIssueListDto> {
  const url = apiUrl(`/dev/jira/issues?projectId=${encodeURIComponent(projectId)}`)
  const response = await fetch(url, { cache: 'no-store', headers: authHeaders() })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<BlinkJiraIssueListDto>
}

export async function deleteBlinkJiraIssue(projectId: string, issueKey: string): Promise<BlinkJiraIssueDeleteDto> {
  const url = apiUrl(
    `/dev/jira/issues/${encodeURIComponent(issueKey)}?projectId=${encodeURIComponent(projectId)}`,
  )
  const response = await fetch(url, { method: 'DELETE', headers: authHeaders() })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<BlinkJiraIssueDeleteDto>
}

export async function deleteJiraIssues(payload: {
  projectId: string
  issueKeys: string[]
}): Promise<BlinkJiraIssueDeleteDto> {
  const url = apiUrl('/integrations/jira/issues/delete')
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      projectId: payload.projectId,
      issueKeys: payload.issueKeys,
    }),
  })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  const raw = (await response.json()) as BlinkJiraIssueDeleteDto & {
    deletedCount?: number
    skippedCount?: number
    deleted?: number | string[]
    skipped?: number | string[]
  }
  const deletedKeys = Array.isArray(raw.deletedKeys)
    ? raw.deletedKeys
    : Array.isArray(raw.deleted)
      ? raw.deleted
      : []
  return {
    deleted: typeof raw.deleted === 'number' ? raw.deleted : raw.deletedCount || deletedKeys.length,
    skipped: typeof raw.skipped === 'number' ? raw.skipped : raw.skippedCount || 0,
    deletedKeys,
    skippedKeys: raw.skippedKeys || [],
    errors: raw.errors || [],
  }
}

export interface JiraIssueStatusItem {
  key: string
  name: string | null
  category: 'todo' | 'in-progress' | 'done' | 'missing' | 'unknown' | string
}

export async function fetchJiraIssueStatuses(payload: {
  projectId: string
  issueKeys: string[]
}): Promise<{ issues: JiraIssueStatusItem[] }> {
  const url = apiUrl('/integrations/jira/issues/statuses')
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      projectId: payload.projectId,
      issueKeys: payload.issueKeys,
    }),
  })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  const raw = (await response.json()) as { issues?: JiraIssueStatusItem[] }
  return { issues: raw.issues || [] }
}

export async function transitionJiraIssue(payload: {
  projectId: string
  issueKey: string
  target: 'done' | 'closed'
}): Promise<JiraIssueStatusItem> {
  const url = apiUrl('/integrations/jira/issues/transition')
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  return response.json() as Promise<JiraIssueStatusItem>
}

export async function deleteAllBlinkJiraIssues(projectId: string): Promise<BlinkJiraIssueDeleteDto> {
  const url = apiUrl(`/dev/jira/issues?projectId=${encodeURIComponent(projectId)}`)
  const response = await fetch(url, { method: 'DELETE', headers: authHeaders() })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<BlinkJiraIssueDeleteDto>
}

export async function fetchGovernanceStatus(projectId: string): Promise<{
  status?: 'idle' | 'preparing' | 'ready' | 'failed' | null
  sodWarnings?: string[]
  nextCommand?: string
  message?: string
}> {
  const url = apiUrl(`/projects/${projectId}/governance-status`)
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<{
    status?: 'idle' | 'preparing' | 'ready' | 'failed' | null
    sodWarnings?: string[]
    nextCommand?: string
    message?: string
  }>
}

export async function fetchProject(id: string): Promise<ProjectDto> {
  const url = apiUrl(`/projects/${id}`)
  const response = await fetch(url, { cache: 'no-store', headers: authHeaders() })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<ProjectDto>
}

export interface CanonicalEligibilityDto {
  spineVersion?: string
  currentStep?: string
  completedThrough?: string
  completedIndex?: number
  allowedSteps?: string[]
  shipSubstage?: string
  allowedShipSubstages?: string[]
  maxShipSubstage?: string
}

export interface ShipStepDto {
  id: number
  stepKind: string
  status: string
  payload?: unknown
  result?: unknown
  idempotencyKey?: string | null
  createdAt?: string
  finishedAt?: string | null
}

export interface ShipSessionDetailDto {
  id: string
  scopeKind?: string
  substage: string
  status: string
  updatedAt?: string
  scopeRef?: string
  allowedSubstages?: string[]
  maxSubstage?: string
  recentSteps?: ShipStepDto[]
}

export interface CanonicalSnapshotDto {
  projectId: number
  revision: number
  wizardDigest?: string
  stageSpine?: string
  eligibility: CanonicalEligibilityDto
  blockers?: unknown
  metadata?: unknown
  migratedFromWizard?: boolean
  updatedAt?: string
}

export async function fetchCanonicalSnapshot(projectId: string): Promise<CanonicalSnapshotDto> {
  const url = apiUrl(`/projects/${projectId}/canonical/snapshot`)
  const response = await fetch(url, { cache: 'no-store', headers: authHeaders() })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<CanonicalSnapshotDto>
}

export type CanonicalGateKind =
  | 'shape'
  | 'g-groom'
  | 'g-plan'
  | 'repository-roster'
  | 'repo-technology-all'

export async function confirmCanonicalGate(
  projectId: string,
  kind: CanonicalGateKind,
  digest: string,
  expectedRevision?: number | null,
): Promise<{ status: string; snapshot: CanonicalSnapshotDto }> {
  const url = apiUrl(`/projects/${projectId}/canonical/gates/confirm`)
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      kind,
      digest,
      expectedRevision: expectedRevision ?? undefined,
    }),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<{ status: string; snapshot: CanonicalSnapshotDto }>
}

export interface GraphViewDto {
  revision: number
  graphDigest: string
  cycles: string[][]
  frontier: string[]
  executionOrder: string[]
}

export async function fetchCanonicalGraph(projectId: string): Promise<GraphViewDto> {
  const url = apiUrl(`/projects/${projectId}/canonical/graph`)
  const response = await fetch(url, { cache: 'no-store', headers: authHeaders() })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<GraphViewDto>
}

export async function fetchRequirementRevisionHistory(
  projectId: string,
  view?: string,
): Promise<{ revisions: { id: number; revisionNo: number; viewKind: string; contentDigest: string; createdAt: string }[] }> {
  const q = view ? `?view=${encodeURIComponent(view)}` : ''
  const url = apiUrl(`/projects/${projectId}/canonical/requirements/history${q}`)
  const response = await fetch(url, { cache: 'no-store', headers: authHeaders() })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<{ revisions: { id: number; revisionNo: number; viewKind: string; contentDigest: string; createdAt: string }[] }>
}

export async function fetchShipSession(projectId: string): Promise<{ session: ShipSessionDetailDto | null }> {
  const url = apiUrl(`/projects/${projectId}/canonical/ship/session`)
  const response = await fetch(url, { cache: 'no-store', headers: authHeaders() })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<{ session: ShipSessionDetailDto | null }>
}

export async function shipCheckpoint(
  projectId: string,
  body: { substage: string; stepKind?: string; idempotencyKey?: string; payload?: Record<string, unknown> },
): Promise<{ status: string; session: { id: string; substage: string } | null }> {
  const url = apiUrl(`/projects/${projectId}/canonical/ship/checkpoint`)
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<{ status: string; session: { id: string; substage: string } | null }>
}

export async function fetchGroomingReadiness(projectId: string): Promise<{
  readiness: {
    questionCount: number
    mandatoryPending: number
    answeredMandatory: number
    groomAcknowledged: boolean
    readyForGGroom: boolean
  }
}> {
  const url = apiUrl(`/projects/${projectId}/canonical/grooming-readiness`)
  const response = await fetch(url, { cache: 'no-store', headers: authHeaders() })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<{
    readiness: {
      questionCount: number
      mandatoryPending: number
      answeredMandatory: number
      groomAcknowledged: boolean
      readyForGGroom: boolean
    }
  }>
}

export async function syncCanonicalWizardDraft(
  projectId: string,
  expectedRevision?: number | null,
): Promise<CanonicalSnapshotDto> {
  const url = apiUrl(`/projects/${projectId}/canonical/commands/execute`)
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      command: 'sync-wizard-draft',
      expectedRevision: expectedRevision ?? undefined,
      idempotencyKey: '',
      payload: {},
    }),
  })
  if (!response.ok) throw new Error(await readError(response))
  await response.json()
  return fetchCanonicalSnapshot(projectId)
}

export async function fetchMyProject(): Promise<ProjectDto | null> {
  const url = apiUrl('/projects/mine')
  const response = await fetch(url, { cache: 'no-store', headers: authHeaders() })
  if (response.status === 204) return null
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<ProjectDto>
}

export async function saveProject(payload: ProjectPayload, projectId?: string | null): Promise<ProjectDto> {
  const url = projectId ? apiUrl(`/projects/${projectId}`) : apiUrl('/projects')
  const method = projectId ? 'PUT' : 'POST'
  console.info(`[blink] ${method} ${url}`, payload)
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 90_000)
  try {
    const response = await fetch(url, {
      method,
      headers: authHeaders(true),
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(await readError(response))
    return response.json() as Promise<ProjectDto>
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Could not save the project. Try again.')
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

export async function configureStakeholders(
  projectId: string,
  stakeholders?: StakeholderPayload[]
): Promise<ConfigureStakeholdersResponse> {
  const url = apiUrl(`/projects/${projectId}/configure-stakeholders`)
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(stakeholders || []),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<ConfigureStakeholdersResponse>
}

export interface ConfirmStakeholdersResponse {
  status: string
  message: string
  nextCommand?: string
  confirmationDigest?: string
  overlayFiles?: OverlayFilePayload[]
  errors?: string[]
}

export async function confirmStakeholders(
  projectId: string,
): Promise<ConfirmStakeholdersResponse> {
  const url = apiUrl(`/projects/${projectId}/confirm-stakeholders`)
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({}),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<ConfirmStakeholdersResponse>
}

export interface IntegrationConnectPayload {
  provider: string
  projectId?: string | null
  baseUrl?: string
  token?: string
  username?: string
  email?: string
  organization?: string
  workspace?: string
  projectKey?: string
  spaceKey?: string
}

export interface JiraProjectItem {
  id: string
  key: string
  name: string
  projectTypeKey?: string
  avatarUrl?: string
}

export interface GithubOrgItem {
  login: string
  name: string
  avatarUrl?: string
  personal?: boolean
}

export interface IntegrationConnectResult {
  connected: boolean
  provider: string
  account: string
  detail: string
  projectKey?: string
  projectName?: string
  baseUrl?: string
  cloudId?: string
  authType?: 'oauth' | 'token'
  token?: string
  projects?: JiraProjectItem[]
  organization?: string
  organizations?: GithubOrgItem[]
}

export interface JiraOAuthUrlResult {
  configured: boolean
  url?: string
  clientId?: string
  redirectUri?: string
  message?: string
}

export type GithubOAuthUrlResult = JiraOAuthUrlResult
export type FigmaOAuthUrlResult = JiraOAuthUrlResult

export class ApiRequestError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function connectIntegration(payload: IntegrationConnectPayload): Promise<IntegrationConnectResult> {
  const url = apiUrl('/integrations/connect')
  console.info(`[blink] POST ${url}`, { provider: payload.provider })
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  return response.json() as Promise<IntegrationConnectResult>
}

export interface SavedIntegrationDto {
  provider: string
  connected: boolean
  account?: string
  detail?: string
  baseUrl?: string
  email?: string
  username?: string
  organization?: string
  workspace?: string
  projectKey?: string
  projectName?: string
  spaceKey?: string
  cloudId?: string
  authType?: 'oauth' | 'token'
  scope?: 'user' | 'project'
}

export async function fetchMyIntegrations(): Promise<SavedIntegrationDto[]> {
  const url = apiUrl('/integrations')
  const response = await fetch(url, { headers: authHeaders(), cache: 'no-store' })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  const data = (await response.json()) as { integrations?: SavedIntegrationDto[] }
  return data.integrations ?? []
}

export async function fetchProjectIntegrations(projectId: string): Promise<SavedIntegrationDto[]> {
  const url = apiUrl(`/projects/${projectId}/integrations`)
  const response = await fetch(url, { headers: authHeaders(), cache: 'no-store' })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  const data = (await response.json()) as { integrations?: SavedIntegrationDto[] }
  return data.integrations ?? []
}

export async function applyMyIntegrationsToProject(projectId: string): Promise<SavedIntegrationDto[]> {
  const url = apiUrl(`/projects/${projectId}/integrations/apply`)
  const response = await fetch(url, { method: 'POST', headers: authHeaders(true), body: '{}' })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  const data = (await response.json()) as { integrations?: SavedIntegrationDto[] }
  return data.integrations ?? []
}

export async function fetchJiraOAuthUrl(): Promise<JiraOAuthUrlResult> {
  const redirectUri = oauthCallbackUrl('jira')
  const url = apiUrl(`/integrations/jira/oauth/url?redirectUri=${encodeURIComponent(redirectUri)}`)
  console.info(`[blink] GET ${url}`)
  const response = await fetch(url, { headers: authHeaders() })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  return response.json() as Promise<JiraOAuthUrlResult>
}

export async function exchangeJiraOAuth(
  code: string,
  redirectUri?: string,
  projectId?: string | null,
): Promise<IntegrationConnectResult> {
  const url = apiUrl('/integrations/jira/oauth/exchange')
  console.info(`[blink] POST ${url}`)
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ code, redirectUri, projectId: projectId || undefined }),
  })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  return response.json() as Promise<IntegrationConnectResult>
}

export async function fetchGithubOAuthUrl(): Promise<GithubOAuthUrlResult> {
  const redirectUri = oauthCallbackUrl('github')
  const url = apiUrl(`/integrations/github/oauth/url?redirectUri=${encodeURIComponent(redirectUri)}`)
  console.info(`[blink] GET ${url}`)
  const response = await fetch(url, { headers: authHeaders() })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  return response.json() as Promise<GithubOAuthUrlResult>
}

export async function exchangeGithubOAuth(
  code: string,
  redirectUri?: string,
  projectId?: string | null,
  organization?: string,
): Promise<IntegrationConnectResult> {
  const url = apiUrl('/integrations/github/oauth/exchange')
  console.info(`[blink] POST ${url}`)
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      code,
      redirectUri,
      projectId: projectId || undefined,
      organization: organization || undefined,
    }),
  })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  return response.json() as Promise<IntegrationConnectResult>
}

export async function fetchFigmaOAuthUrl(): Promise<FigmaOAuthUrlResult> {
  const redirectUri = oauthCallbackUrl('figma')
  const url = apiUrl(`/integrations/figma/oauth/url?redirectUri=${encodeURIComponent(redirectUri)}`)
  console.info(`[blink] GET ${url}`)
  const response = await fetch(url, { headers: authHeaders() })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  return response.json() as Promise<FigmaOAuthUrlResult>
}

export async function exchangeFigmaOAuth(
  code: string,
  redirectUri?: string,
  projectId?: string | null,
  organization?: string,
): Promise<IntegrationConnectResult> {
  const url = apiUrl('/integrations/figma/oauth/exchange')
  console.info(`[blink] POST ${url}`)
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      code,
      redirectUri,
      projectId: projectId || undefined,
      organization: organization || undefined,
    }),
  })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  return response.json() as Promise<IntegrationConnectResult>
}

export async function saveIntegrationBinding(payload: {
  projectId: string
  provider: string
  projectKey?: string
  projectName?: string
  spaceKey?: string
  organization?: string
}): Promise<IntegrationConnectResult> {
  const url = apiUrl('/integrations/binding')
  console.info(`[blink] POST ${url}`, { provider: payload.provider, projectKey: payload.projectKey, organization: payload.organization })
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  return response.json() as Promise<IntegrationConnectResult>
}

export async function fetchJiraProjects(payload: {
  projectId?: string | null
  baseUrl?: string
  email?: string
  token?: string
  cloudId?: string
  accessToken?: string
}): Promise<JiraProjectItem[]> {
  const url = apiUrl('/integrations/jira/projects')
  console.info(`[blink] POST ${url}`)
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  return response.json() as Promise<JiraProjectItem[]>
}

export async function fetchGithubOrgs(payload: {
  projectId?: string | null
  token?: string
}): Promise<GithubOrgItem[]> {
  const url = apiUrl('/integrations/github/orgs')
  console.info(`[blink] POST ${url}`)
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  return response.json() as Promise<GithubOrgItem[]>
}

export async function fetchFigmaTeams(payload: {
  projectId?: string | null
  token?: string
}): Promise<GithubOrgItem[]> {
  const url = apiUrl('/integrations/figma/teams')
  console.info(`[blink] POST ${url}`)
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  return response.json() as Promise<GithubOrgItem[]>
}

export async function fetchFigmaProjects(payload: {
  projectId?: string | null
  token?: string
  organization?: string
}): Promise<JiraProjectItem[]> {
  const url = apiUrl('/integrations/figma/projects')
  console.info(`[blink] POST ${url}`)
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  return response.json() as Promise<JiraProjectItem[]>
}

export interface FigmaFileItem {
  key: string
  name: string
  thumbnailUrl?: string
  lastModified?: string
}

export interface FigmaFrameItem {
  nodeId: string
  name: string
  pageId?: string
  pageName?: string
  type?: string
}

export interface FigmaScreenBindingPayload {
  nodeId: string
  name: string
  pageId?: string
  pageName?: string
  type?: string
  storyId?: string | null
  jiraKey?: string | null
  fingerprint?: string
  thumbnailUrl?: string | null
}

export interface FigmaDesignBindingResult {
  bound?: boolean
  projectId?: string
  fileKey?: string
  fileName?: string
  fileUrl?: string
  fileVersion?: string
  syncJira?: boolean
  webhookId?: string
  webhookStatus?: string
  lastSyncedAt?: string
  lastSyncSummary?: string
  markdown?: string
  screens?: FigmaScreenBindingPayload[]
  changes?: {
    kind?: string
    nodeId?: string
    name?: string
    previousName?: string
    storyId?: string
    jiraKey?: string
    detail?: string
  }[]
  jiraUpdates?: { issueKey?: string; status?: string; commentId?: string; message?: string }[]
}

export async function fetchFigmaFiles(payload: {
  projectId?: string | null
  figmaProjectId?: string
}): Promise<FigmaFileItem[]> {
  const url = apiUrl('/integrations/figma/files')
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  return response.json() as Promise<FigmaFileItem[]>
}

export async function fetchFigmaFrames(payload: {
  projectId?: string | null
  fileKey?: string
  fileUrl?: string
}): Promise<FigmaFrameItem[]> {
  const url = apiUrl('/integrations/figma/frames')
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  return response.json() as Promise<FigmaFrameItem[]>
}

export async function fetchFigmaDesign(projectId: string): Promise<FigmaDesignBindingResult> {
  const url = apiUrl(`/integrations/figma/design?projectId=${encodeURIComponent(projectId)}`)
  const response = await fetch(url, { headers: authHeaders() })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  return response.json() as Promise<FigmaDesignBindingResult>
}

export async function clearFigmaDesign(projectId: string): Promise<FigmaDesignBindingResult> {
  const url = apiUrl(`/integrations/figma/design?projectId=${encodeURIComponent(projectId)}`)
  const response = await fetch(url, { method: 'DELETE', headers: authHeaders() })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  return response.json() as Promise<FigmaDesignBindingResult>
}

export async function saveFigmaDesign(payload: {
  projectId: string
  fileKey?: string
  fileUrl?: string
  fileName?: string
  figmaProjectId?: string
  syncJira?: boolean
  screens?: FigmaScreenBindingPayload[]
  stories?: { id: string; title: string }[]
  jiraIssues?: { sourceId: string; jiraKey: string }[]
}): Promise<FigmaDesignBindingResult> {
  const url = apiUrl('/integrations/figma/design')
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  return response.json() as Promise<FigmaDesignBindingResult>
}

export async function ingestFigmaDesign(payload: {
  projectId: string
  fileKey?: string
  fileUrl?: string
  syncJira?: boolean
  stories?: { id: string; title: string }[]
  jiraIssues?: { sourceId: string; jiraKey: string }[]
}): Promise<FigmaDesignBindingResult> {
  const url = apiUrl('/integrations/figma/ingest')
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  return response.json() as Promise<FigmaDesignBindingResult>
}

export interface JiraCreatedIssueResult {
  id?: string
  sourceId?: string
  jiraKey?: string | null
  url?: string | null
  jiraUrl?: string | null
  type?: string
  status?: string
  message?: string
}

export interface CreateJiraIssuesPayload {
  projectId?: string | null
  baseUrl?: string
  email?: string
  token?: string
  cloudId?: string
  accessToken?: string
  projectKey: string
  epics?: {
    id?: string
    title: string
    objective?: string
    storyIds?: string[]
  }[]
  stories?: {
    id?: string
    epicId?: string
    epicKey?: string
    title: string
    objective?: string
    asA?: string
    iWant?: string
    soThat?: string
    acceptanceCriteria?: string[]
  }[]
}

export interface CreateJiraIssuesResult {
  status: string
  message: string
  issues: JiraCreatedIssueResult[]
  errors?: string[]
}

export async function createJiraIssues(payload: CreateJiraIssuesPayload): Promise<CreateJiraIssuesResult> {
  const url = apiUrl('/integrations/jira/issues')
  console.info(`[blink] POST ${url}`, { projectKey: payload.projectKey, epics: payload.epics?.length, stories: payload.stories?.length })
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  const raw = (await response.json()) as CreateJiraIssuesResult & {
    created?: Array<JiraCreatedIssueResult & { id?: string; url?: string | null }>
  }
  const rows = raw.issues?.length ? raw.issues : raw.created || []
  const issues = rows.map((row) => {
    const sourceId = row.sourceId || row.id
    const jiraUrl = row.jiraUrl || row.url || null
    return {
      ...row,
      sourceId,
      jiraUrl,
    }
  })
  return {
    status: raw.status,
    message: raw.message,
    errors: raw.errors,
    issues,
  }
}

export async function streamCreateJiraIssues(
  payload: CreateJiraIssuesPayload,
  handlers: {
    onStart?: (total: number, projectKey: string) => void
    onItem?: (issue: JiraCreatedIssueResult) => void
  },
  signal?: AbortSignal,
): Promise<CreateJiraIssuesResult> {
  const url = apiUrl('/integrations/jira/issues')
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(true),
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(payload),
    signal,
  })
  const contentType = response.headers.get('content-type') || ''
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  if (!contentType.includes('text/event-stream') || !response.body) {
    const raw = (await response.json()) as CreateJiraIssuesResult & {
      created?: Array<JiraCreatedIssueResult & { id?: string; url?: string | null }>
    }
    const rows = raw.issues?.length ? raw.issues : raw.created || []
    return {
      status: raw.status,
      message: raw.message,
      errors: raw.errors,
      issues: rows.map((row) => ({
        ...row,
        sourceId: row.sourceId || row.id,
        jiraUrl: row.jiraUrl || row.url || null,
      })),
    }
  }

  let result: CreateJiraIssuesResult = { status: 'ok', message: '', issues: [] }
  await readSse(response.body, (event, data) => {
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(data) as Record<string, unknown>
    } catch {
      return
    }
    if (event === 'start') {
      const total = typeof parsed.total === 'number' ? parsed.total : 0
      const projectKey = typeof parsed.projectKey === 'string' ? parsed.projectKey : ''
      handlers.onStart?.(total, projectKey)
      return
    }
    if (event === 'item') {
      const row = parsed as JiraCreatedIssueResult & { id?: string; url?: string | null }
      const issue = {
        ...row,
        sourceId: row.sourceId || row.id,
        jiraUrl: row.jiraUrl || row.url || null,
      }
      result.issues = [...result.issues, issue]
      handlers.onItem?.(issue)
      return
    }
    if (event === 'done') {
      const raw = parsed as unknown as CreateJiraIssuesResult & {
        created?: Array<JiraCreatedIssueResult & { id?: string; url?: string | null }>
      }
      const rows = raw.issues?.length ? raw.issues : raw.created || result.issues
      result = {
        status: raw.status || result.status,
        message: raw.message || result.message,
        errors: raw.errors,
        issues: rows.map((row) => ({
          ...row,
          sourceId: row.sourceId || row.id,
          jiraUrl: row.jiraUrl || row.url || null,
        })),
      }
    }
  })
  return result
}

export interface CreateJiraCommentPayload {
  projectId?: string | null
  issueKey: string
  body: string
  blinkQuestionId?: string
  /** When set, posts as a threaded child reply under this comment */
  parentCommentId?: string | null
}

export interface CreateJiraCommentResult {
  status: string
  message: string
  issueKey: string
  commentId?: string | null
  blinkQuestionId?: string | null
}

export async function createJiraComment(payload: CreateJiraCommentPayload): Promise<CreateJiraCommentResult> {
  const url = apiUrl('/integrations/jira/comments')
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  return response.json() as Promise<CreateJiraCommentResult>
}

export interface PollJiraCommentsPayload {
  projectId?: string | null
  items: { issueKey: string; blinkQuestionId: string }[]
}

export interface PollJiraCommentReply {
  blinkQuestionId: string
  issueKey: string
  commentId?: string | null
  author?: string | null
  body: string
  created?: string | null
}

export interface PollJiraThreadReply {
  commentId: string
  body: string
  author?: string | null
  created?: string | null
  parentId?: string | null
}

export interface PollJiraThread {
  blinkQuestionId: string
  issueKey: string
  parentCommentId?: string | null
  parentBody?: string | null
  replies: PollJiraThreadReply[]
}

export interface PollJiraCommentsResult {
  status: string
  message: string
  replies: PollJiraCommentReply[]
  threads?: PollJiraThread[]
}

export async function pollJiraComments(payload: PollJiraCommentsPayload): Promise<PollJiraCommentsResult> {
  const url = apiUrl('/integrations/jira/comments/poll')
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  return response.json() as Promise<PollJiraCommentsResult>
}

export interface ResetSimulatedJiraRepliesPayload {
  projectId?: string | null
  items: { issueKey: string; blinkQuestionId?: string; replyCommentId?: string | null }[]
}

export interface ResetSimulatedJiraRepliesResult {
  status: string
  message: string
  deleted: number
  errors?: string[]
}

export async function resetSimulatedJiraReplies(
  payload: ResetSimulatedJiraRepliesPayload,
): Promise<ResetSimulatedJiraRepliesResult> {
  const url = apiUrl('/integrations/jira/comments/reset-simulated')
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  return response.json() as Promise<ResetSimulatedJiraRepliesResult>
}

export interface SummarizeDiscussionPayload {
  question: string
  parentBody?: string | null
  issueKey?: string | null
  replies: {
    commentId: string
    author?: string | null
    body: string
    created?: string | null
    parentId?: string | null
  }[]
}

export interface SummarizeDiscussionResult {
  status: string
  message: string
  summary: string
  resolvedAnswer: string
  source?: 'agent' | 'local' | string
  agentError?: string
}

export async function summarizeDiscussion(
  payload: SummarizeDiscussionPayload,
): Promise<SummarizeDiscussionResult> {
  const url = apiUrl('/integrations/jira/discussions/summarize')
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  const raw = (await response.json()) as SummarizeDiscussionResult
  return {
    status: raw.status || 'ok',
    message: raw.message || '',
    summary: (raw.summary || '').trim(),
    resolvedAnswer: (raw.resolvedAnswer || '').trim(),
    source: raw.source,
    agentError: raw.agentError,
  }
}

export interface CreateRepositoriesPayload {
  provider: string
  projectId?: string | null
  token?: string
  username?: string
  organization?: string
  workspace?: string
  repositories: { name: string; description?: string }[]
}

export interface CreatedRepository {
  name: string
  status: 'created' | 'exists' | 'failed' | string
  htmlUrl: string | null
  message: string
}

export interface CreateRepositoriesResult {
  provider: string
  repositories: CreatedRepository[]
}

export async function createRepositories(payload: CreateRepositoriesPayload): Promise<CreateRepositoriesResult> {
  const url = apiUrl('/integrations/repositories')
  console.info(`[blink] POST ${url}`, { provider: payload.provider, count: payload.repositories.length })
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new ApiRequestError(await readError(response), response.status)
  const raw = (await response.json()) as {
    provider?: string
    repositories?: CreatedRepository[]
    results?: Array<{ name: string; status: string; htmlUrl?: string | null; url?: string | null; message?: string }>
  }
  const rows = Array.isArray(raw.repositories)
    ? raw.repositories
    : Array.isArray(raw.results)
      ? raw.results.map((item) => ({
          name: item.name,
          status: item.status,
          htmlUrl: item.htmlUrl ?? item.url ?? null,
          message: item.message || '',
        }))
      : []
  return {
    provider: raw.provider || payload.provider,
    repositories: rows.map((item) => ({
      name: item.name,
      status: item.status,
      htmlUrl: item.htmlUrl ?? null,
      message: item.message || '',
    })),
  }
}

export interface WorkspaceEntryDto {
  name: string
  kind: 'file' | 'directory'
}

export interface DownloadResult {
  blob: Blob
  filename: string
  structure: WorkspaceEntryDto[]
  fileCount: number
  nextCommand: string
  setupStatus: string
  setupValidated: boolean
  identitySource: string
  overlayCount: number
  contextReady: boolean
  deliveryReady: boolean
  folderStatus: string
}

function parseStructureHeader(header: string | null): WorkspaceEntryDto[] {
  if (!header) return []
  return header.split(',').flatMap((part) => {
    const trimmed = part.trim()
    const splitAt = trimmed.lastIndexOf(':')
    if (splitAt <= 0) return []
    const name = trimmed.slice(0, splitAt)
    const kind = trimmed.slice(splitAt + 1)
    if (kind !== 'file' && kind !== 'directory') return []
    return [{ name, kind }]
  })
}

export async function downloadWorkspace(options: {
  projectId: string
  file: File | null
  requirementsText: string
  repositories?: { name: string; purpose?: string; description?: string }[]
  setupContext?: Record<string, unknown>
  /** Connected integration ids for .cursor/mcp.json (github, jira, confluence). */
  mcpProviders?: string[]
  /** Non-secret site hints for automation_sdlc/.env.mcp.example (never tokens). */
  mcpSiteHints?: {
    jiraUrl?: string
    jiraEmail?: string
    confluenceUrl?: string
    confluenceEmail?: string
    jiraCloudId?: string
  }
}): Promise<DownloadResult> {
  const form = new FormData()
  if (options.file) form.append('file', options.file)
  if (options.requirementsText.trim()) form.append('requirementsText', options.requirementsText)
  if (options.repositories?.length) {
    for (const repo of options.repositories) {
      const name = repo.name.trim()
      if (!name) continue
      form.append('repoName', name)
      form.append('repoPurpose', repo.purpose ?? '')
      form.append('repoDescription', repo.description ?? '')
    }
  }
  if (options.setupContext) form.append('setupContext', JSON.stringify(options.setupContext))
  if (options.mcpProviders?.length) {
    for (const provider of options.mcpProviders) {
      const id = provider.trim().toLowerCase()
      if (id) form.append('mcpProvider', id)
    }
  }
  const hints = options.mcpSiteHints
  if (hints?.jiraUrl?.trim()) form.append('mcpJiraUrl', hints.jiraUrl.trim())
  if (hints?.jiraEmail?.trim()) form.append('mcpJiraEmail', hints.jiraEmail.trim())
  if (hints?.confluenceUrl?.trim()) form.append('mcpConfluenceUrl', hints.confluenceUrl.trim())
  if (hints?.confluenceEmail?.trim()) form.append('mcpConfluenceEmail', hints.confluenceEmail.trim())
  if (hints?.jiraCloudId?.trim()) form.append('mcpJiraCloudId', hints.jiraCloudId.trim())
  const url = apiUrl(`/projects/${options.projectId}/download`)
  console.info(`[blink] POST ${url}`)
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 180_000)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(await readError(response))
    console.info(`[blink] download HTTP ${response.status} bytes=${response.headers.get('content-length') ?? '?'}`)
    const original = await response.blob()
    const stripped = await stripExcludedZipFolders(original)
    const filename =
      response.headers.get('Content-Disposition')?.match(/filename="?([^";]+)"?/)?.[1] ?? 'project-workspace.zip'
    const structure = sanitizeDownloadStructure(
      parseStructureHeader(response.headers.get('X-Blink-Workspace-Structure')),
    )
    const headerCount = Number(response.headers.get('X-Blink-File-Count') ?? '0')
    const fileCount = Number.isFinite(headerCount) ? Math.max(0, headerCount - stripped.removed) : 0
    const overlayCount = Number(response.headers.get('X-Blink-Overlay-Count') ?? '0')
    return {
      blob: stripped.blob,
      filename,
      structure,
      fileCount,
      nextCommand: response.headers.get('X-Blink-Next-Command')?.trim() || '',
      setupStatus: response.headers.get('X-Blink-Setup-Status')?.trim() || '',
      setupValidated: response.headers.get('X-Blink-Setup-Validated')?.trim().toLowerCase() === 'true',
      identitySource: response.headers.get('X-Blink-Identity-Source')?.trim() || '',
      overlayCount: Number.isFinite(overlayCount) ? overlayCount : 0,
      contextReady: response.headers.get('X-Blink-Context-Ready') === 'true',
      deliveryReady: response.headers.get('X-Blink-Delivery-Ready') === 'true',
      folderStatus: response.headers.get('X-Blink-Folder-Status')?.trim() || '',
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Download took too long. Try again.')
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

export interface GroomOptionDto {
  id: string
  label: string
  description?: string
}

export interface GroomQuestionDto {
  id: string
  text: string
  subtitle?: string
  options: GroomOptionDto[]
  allowOther: boolean
  allowMultiple?: boolean
  priority?: 'need_clarification' | 'important' | 'suggestion'
  ownerRole?: string
}

export interface GroomClarifyResult {
  runId?: string
  command?: string
  status: string
  message: string
  questions: GroomQuestionDto[]
  requirementDraft: string
  originalRequirement: string
  errors?: string[]
}

export async function clarifyRequirement(options: {
  projectId?: string | null
  projectName?: string
  requirementText: string
  answers?: { questionId: string; optionId: string; optionLabel?: string; otherText?: string }[]
}): Promise<GroomClarifyResult> {
  const url = apiUrl('/grooming/clarify')
  const answers = options.answers?.filter(
    (item) => item.optionId !== 'other' || Boolean(item.otherText?.trim()),
  )
  const body = {
    projectId: options.projectId || undefined,
    projectName: options.projectName || undefined,
    requirementText: options.requirementText,
    answers: answers?.length ? answers : undefined,
  }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 100_000)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          isLocalApi()
            ? 'Local Blink API does not have the grooming endpoint. Restart blink-backend on port 8090 with the latest code.'
            : (await readError(response)) || 'Grooming is not available on this API yet.',
        )
      }
      throw new Error(await readError(response))
    }
    const parsed = (await response.json()) as GroomClarifyResult
    return {
      ...parsed,
      questions: normalizeGroomQuestions(parsed.questions),
      requirementDraft: parsed.requirementDraft ?? '',
      originalRequirement: parsed.originalRequirement ?? options.requirementText,
      message: parsed.message ?? '',
      status: parsed.status ?? 'error',
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('The grooming helper took too long. Try again.')
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

export async function streamClarifyRequirement(
  options: {
    projectId?: string | null
    projectName?: string
    requirementText: string
    answers?: { questionId: string; optionId: string; optionLabel?: string; otherText?: string }[]
  },
  handlers: { onThinking?: (text: string) => void } = {},
  signal?: AbortSignal,
): Promise<GroomClarifyResult> {
  const answers = options.answers?.filter(
    (item) => item.optionId !== 'other' || Boolean(item.otherText?.trim()),
  )
  const body = {
    projectId: options.projectId || undefined,
    projectName: options.projectName || undefined,
    requirementText: options.requirementText,
    answers: answers?.length ? answers : undefined,
  }
  try {
    const done = await postSseJson<GroomClarifyResult>(
      '/grooming/clarify',
      body,
      { onThinking: handlers.onThinking },
      signal,
    )
    return {
      ...done,
      questions: normalizeGroomQuestions(done.questions),
      requirementDraft: done.requirementDraft ?? '',
      originalRequirement: done.originalRequirement ?? options.requirementText,
      message: done.message ?? '',
      status: done.status ?? 'error',
    }
  } catch {
    return clarifyRequirement(options)
  }
}

export interface OverlayFilePayload {
  path: string
  content: string
}

export interface PlanProductScopeResponse {
  status: string
  message: string
  nextCommand: string
  proposalDigest?: string
  epicIds?: string[]
  storyIds?: string[]
  productScope?: ProductScopeData
  overlayFiles?: OverlayFilePayload[]
  errors?: string[]
}

export type PlanProductScopePayload = {
  projectName?: string
  requirementText: string
  actor?: string
  refresh?: boolean
  scopeFeedback?: string
  productScope?: ProductScopeData | null
  answers?: { questionId: string; optionId: string; optionLabel?: string; otherText?: string }[]
}

export async function planProductScope(
  projectId?: string | null,
  payload?: PlanProductScopePayload,
): Promise<PlanProductScopeResponse> {
  const path = projectId ? `/projects/${projectId}/plan-product-scope` : `/projects/plan-product-scope`
  const url = apiUrl(path)
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      projectId: projectId || undefined,
      projectName: payload?.projectName,
      requirementText: payload?.requirementText,
      actor: payload?.actor || 'operator',
      refresh: payload?.refresh || undefined,
      scopeFeedback: payload?.scopeFeedback,
      productScope: payload?.productScope || undefined,
      answers: payload?.answers,
    }),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<PlanProductScopeResponse>
}

export async function streamPlanProductScope(
  projectId: string | null | undefined,
  payload: PlanProductScopePayload,
  handlers: { onThinking?: (text: string) => void },
  signal?: AbortSignal,
): Promise<PlanProductScopeResponse> {
  const path = projectId ? `/projects/${projectId}/plan-product-scope` : `/projects/plan-product-scope`
  try {
    return await postSseJson<PlanProductScopeResponse>(
      path,
      {
        projectId: projectId || undefined,
        projectName: payload.projectName,
        requirementText: payload.requirementText,
        actor: payload.actor || 'operator',
        refresh: payload.refresh || undefined,
        scopeFeedback: payload.scopeFeedback,
        productScope: payload.productScope || undefined,
        answers: payload.answers,
      },
      { onThinking: handlers.onThinking },
      signal,
    )
  } catch {
    return planProductScope(projectId, payload)
  }
}

export interface ClarifyProductScopeResponse {
  status: string
  message: string
  nextCommand?: string
  questions?: GroomQuestionDto[]
  errors?: string[]
}

export async function clarifyProductScope(
  projectId: string | null | undefined,
  payload: {
    projectName?: string
    requirementText: string
    productScope?: ProductScopeData | null
    actor?: string
  },
): Promise<ClarifyProductScopeResponse> {
  const path = projectId ? `/projects/${projectId}/clarify-product-scope` : `/projects/clarify-product-scope`
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      projectId: projectId || undefined,
      projectName: payload.projectName,
      requirementText: payload.requirementText,
      productScope: payload.productScope || undefined,
      actor: payload.actor || 'operator',
    }),
  })
  if (!response.ok) throw new Error(await readError(response))
  const parsed = (await response.json()) as ClarifyProductScopeResponse
  return {
    ...parsed,
    questions: normalizeGroomQuestions(parsed.questions),
  }
}

export interface AdvisoryAgentResponse {
  status: string
  message: string
  nextCommand?: string
  errors?: string[]
  overlayFiles?: OverlayFilePayload[]
  productScope?: ProductScopeData
  proposalDigest?: string
  confirmationDigest?: string
  productScopeRevision?: number
  workClassification?: WorkClassificationData
  classification?: WorkClassificationData
  specification?: SpecificationData
  technicalPlan?: TechnicalPlanData
  issueId?: string
  designSpec?: {
    options?: DesignOption[]
    markdown?: string
    screens?: unknown
    changes?: unknown
    title?: string
    summary?: string
  }
}

export interface WorkClassificationData {
  tier?: number
  workType?: string
  workSubtype?: string | null
  modernizationEnabled?: boolean
  modernizationType?: string | null
  riskSummary?: string
  evidence?: string[]
  requiredRigor?: string[]
  openQuestions?: string[]
  defaultIfAmbiguous?: string
  markdown?: string
  issueId?: string
}

export interface SpecificationData {
  title?: string
  summary?: string
  acceptanceCriteria?: string[]
  openQuestions?: string[]
  markdown?: string
  issueId?: string
}

export interface TechnicalPlanData {
  summary?: string
  steps?: { id?: string; title?: string; detail?: string }[]
  rollback?: string
  testStrategy?: string
  openQuestions?: string[]
  markdown?: string
  issueId?: string
}

async function postAdvisory(
  projectId: string,
  pathSuffix: string,
  body: Record<string, unknown>,
): Promise<AdvisoryAgentResponse> {
  const response = await fetch(apiUrl(`/projects/${projectId}/${pathSuffix}`), {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<AdvisoryAgentResponse>
}

export function confirmProductScope(
  projectId: string,
  payload: {
    expectedDigest: string
    expectedRevision?: number
    overlayFiles: OverlayFilePayload[]
    actor?: string
  },
) {
  return postAdvisory(projectId, 'confirm-product-scope', payload)
}

export function classifyWork(
  projectId: string,
  payload: {
    requirementText?: string
    productScope?: ProductScopeData | null
    overlayFiles?: OverlayFilePayload[]
    issueId?: string
    actor?: string
  },
) {
  return postAdvisory(projectId, 'classify-work', payload)
}

export async function proposeDesigns(
  projectId: string | null | undefined,
  payload: {
    projectName?: string
    requirementText?: string
    productScope?: ProductScopeData | null
    issueId?: string
    actor?: string
  },
): Promise<AdvisoryAgentResponse> {
  const path = projectId ? `/projects/${projectId}/propose-designs` : `/projects/propose-designs`
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      projectId: projectId || undefined,
      projectName: payload.projectName,
      requirementText: payload.requirementText,
      productScope: payload.productScope || undefined,
      issueId: payload.issueId,
      actor: payload.actor || 'operator',
    }),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<AdvisoryAgentResponse>
}

export function createSpec(
  projectId: string,
  payload: {
    requirementText?: string
    productScope?: ProductScopeData | null
    workClassification?: WorkClassificationData | null
    overlayFiles?: OverlayFilePayload[]
    issueId?: string
    actor?: string
  },
) {
  return postAdvisory(projectId, 'create-spec', payload)
}

export function technicalPlan(
  projectId: string,
  payload: {
    requirementText?: string
    productScope?: ProductScopeData | null
    workClassification?: WorkClassificationData | null
    specification?: SpecificationData | null
    overlayFiles?: OverlayFilePayload[]
    issueId?: string
    actor?: string
    topology?: string
    repositoryModel?: string
    architectureStyle?: string
    repositories?: WizardState['repositories']
    repoTechnologies?: WizardState['repoTechnologies']
  },
) {
  return postAdvisory(projectId, 'technical-plan', payload)
}

export function sdlcStart(
  projectId: string,
  payload: {
    requirementText?: string
    productScope?: ProductScopeData | null
    overlayFiles?: OverlayFilePayload[]
    issueId?: string
    actor?: string
  },
) {
  return postAdvisory(projectId, 'sdlc-start', payload)
}

export function sdlcNext(
  projectId: string,
  payload: {
    requirementText?: string
    productScope?: ProductScopeData | null
    workClassification?: WorkClassificationData | null
    specification?: SpecificationData | null
    technicalPlan?: TechnicalPlanData | null
    overlayFiles?: OverlayFilePayload[]
    issueId?: string
    groomAcknowledged?: boolean
    planAcknowledged?: boolean
    shipPlanAcknowledged?: boolean
    bootstrapAcknowledged?: boolean
    implementationAuthorized?: boolean
    impactAnalysisSkipped?: boolean
    actor?: string
  },
) {
  return postAdvisory(projectId, 'sdlc-next', payload)
}

export interface StakeholderPackData {
  issueId?: string
  markdown?: string
  rolesCovered?: string[]
  openQuestions?: string[]
  generatedAt?: string
}

export interface GroomingRevisionData {
  issueId?: string
  revisionNumber?: number
  requirementMarkdown?: string
  revisionSummaryMarkdown?: string
  changesApplied?: string[]
}

export interface GroomingSignOffData {
  issueId?: string
  markdown?: string
  readyForHumanSignOff?: boolean
  blockers?: string[]
  openQuestions?: string[]
  capturedAt?: string
}

export interface ImplementStepData {
  issueId?: string
  commitMessage?: string
  summary?: string
  files?: { path: string; content: string; repoHint?: string }[]
  notes?: string[]
}

export interface QaValidationData {
  issueId?: string
  verdict?: string
  summary?: string
  checks?: { name?: string; status?: string; detail?: string }[]
  acceptanceCriteria?: { criterion?: string; status?: string }[]
  markdown?: string
  blockers?: string[]
  draftPrUrl?: string | null
}

export interface DraftPullRequest {
  url?: string
  number?: number
  branch?: string
  owner?: string
  repo?: string
  sha?: string
  kind?: string
}

export interface DeliveryAgentResponse extends AdvisoryAgentResponse {
  stakeholderPack?: StakeholderPackData
  groomingRevision?: GroomingRevisionData
  groomingSignOff?: GroomingSignOffData
  implementStep?: ImplementStepData
  qaValidation?: QaValidationData
  requirementDraft?: string
  gitWritten?: boolean
  commit?: { sha?: string; url?: string; branch?: string; owner?: string; repo?: string; treeCount?: number }
  draftPullRequests?: DraftPullRequest[]
  evidence?: Record<string, unknown>
}

export function groomingStakeholderPack(
  projectId: string,
  payload: {
    requirementText?: string
    overlayFiles?: OverlayFilePayload[]
    issueId?: string
    actor?: string
  },
) {
  return postAdvisory(projectId, 'grooming-stakeholder-pack', payload) as Promise<DeliveryAgentResponse>
}

export function groomingRevision(
  projectId: string,
  payload: {
    requirementText?: string
    stakeholderFeedback?: string
    overlayFiles?: OverlayFilePayload[]
    groomingRevision?: GroomingRevisionData | null
    issueId?: string
    actor?: string
  },
) {
  return postAdvisory(projectId, 'grooming-revision', payload) as Promise<DeliveryAgentResponse>
}

export function groomingSignOffCapture(
  projectId: string,
  payload: {
    requirementText?: string
    stakeholderFeedback?: string
    overlayFiles?: OverlayFilePayload[]
    issueId?: string
    actor?: string
  },
) {
  return postAdvisory(projectId, 'grooming-sign-off-capture', payload) as Promise<DeliveryAgentResponse>
}

export async function gitApply(
  projectId: string,
  payload: {
    confirm: boolean
    overlayFiles: OverlayFilePayload[]
    repositories?: { name: string; htmlUrl?: string; purpose?: string }[]
    workspaceRepo?: string
    commitMessage?: string
    issueKey?: string
  },
): Promise<DeliveryAgentResponse> {
  const response = await fetch(apiUrl(`/projects/${projectId}/git-apply`), {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<DeliveryAgentResponse>
}

export async function implementStep(
  projectId: string,
  payload: Record<string, unknown>,
): Promise<DeliveryAgentResponse> {
  const response = await fetch(apiUrl(`/projects/${projectId}/implement-step`), {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<DeliveryAgentResponse>
}

export function qaValidation(
  projectId: string,
  payload: Record<string, unknown>,
) {
  return postAdvisory(projectId, 'qa-validation', payload) as Promise<DeliveryAgentResponse>
}

export async function postJiraGateEvidence(
  projectId: string,
  payload: { issueKey: string; gate: 'G-GROOM' | 'G-PLAN' | 'G-BOOTSTRAP' | 'G-PR-OPEN'; message: string },
): Promise<{ status: string; message?: string; commentId?: string; gate?: string }> {
  const response = await fetch(apiUrl(`/projects/${projectId}/jira-gate-evidence`), {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export interface ChatMessageDto {
  id: number
  threadId: number
  role: string
  content: string
  model?: string | null
  mode?: string | null
  toolJson?: unknown
  turnId?: string | null
  createdAt: string
}

export interface ChatThreadResponse {
  thread: { id: number; projectId: number; ownerEmail: string }
  messages: ChatMessageDto[]
  models: string[]
}

export async function fetchProjectChat(projectId: string): Promise<ChatThreadResponse> {
  const response = await fetch(apiUrl(`/projects/${projectId}/chat`), { headers: authHeaders() })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<ChatThreadResponse>
}

export async function clearProjectChat(projectId: string): Promise<void> {
  const response = await fetch(apiUrl(`/projects/${projectId}/chat/messages`), {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!response.ok) throw new Error(await readError(response))
}

type SseHandlers = {
  onUser?: (message: ChatMessageDto, turnId: string) => void
  onAssistantStart?: (turnId: string) => void
  onToken: (text: string) => void
  onDone: (message: ChatMessageDto, turnId: string) => void
  onError?: (message: string) => void
}

async function readSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel()
        break
      }
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      buffer = consumeSseBuffer(buffer, { onEvent })
    }
    buffer += decoder.decode()
    consumeSseBuffer(buffer, { onEvent })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return
    throw error
  }
}

async function postSseJson<T>(
  path: string,
  body: unknown,
  handlers: { onThinking?: (text: string) => void },
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: {
      ...authHeaders(true),
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  })
  const contentType = response.headers.get('content-type') || ''
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  if (!contentType.includes('text/event-stream') || !response.body) {
    return (await response.json()) as T
  }
  let donePayload: T | null = null
  let streamError: string | null = null
  await readSse(
    response.body,
    (event, data) => {
      let parsed: Record<string, unknown> = {}
      try {
        parsed = JSON.parse(data) as Record<string, unknown>
      } catch {
        return
      }
      if (event === 'thinking') {
        const text = typeof parsed.text === 'string' ? parsed.text : ''
        if (text) handlers.onThinking?.(text)
        return
      }
      if (event === 'error') {
        streamError = typeof parsed.message === 'string' ? parsed.message : streamError
        return
      }
      if (event === 'done') {
        donePayload = parsed as T
      }
    },
    signal,
  )
  if (donePayload) return donePayload
  throw new Error(streamError || 'The agent stream ended before it finished.')
}

/** Parse SSE frames correctly across TCP chunks (multi-line data, event reset on blank line). */
function consumeSseBuffer(
  buffer: string,
  handlers: {
    onEvent: (event: string, data: string) => void
  },
): string {
  let rest = buffer
  while (true) {
    const sep = rest.indexOf('\n\n')
    if (sep < 0) break
    const rawFrame = rest.slice(0, sep)
    rest = rest.slice(sep + 2)
    // Normalize CRLF frames from some proxies.
    const frame = rawFrame.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    if (!frame.trim()) continue
    let event = 'message'
    const dataLines: string[] = []
    for (const line of frame.split('\n')) {
      if (!line || line.startsWith(':')) continue
      if (line.startsWith('event:')) {
        event = line.slice(6).trim()
        continue
      }
      if (line.startsWith('data:')) {
        // Spec: optional single leading space after data:
        const value = line.startsWith('data: ') ? line.slice(6) : line.slice(5)
        dataLines.push(value)
      }
    }
    if (dataLines.length === 0) continue
    handlers.onEvent(event, dataLines.join('\n'))
  }
  return rest
}

/**
 * Live chat turn: one POST that streams LLM tokens as they arrive (not a fake replay).
 * Events: user → assistant_start → token* → message_done | error
 */
export async function streamProjectChatMessage(
  projectId: string,
  body: { text: string; mode?: string; model?: string; currentStep?: string },
  handlers: SseHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(apiUrl(`/projects/${projectId}/chat/messages`), {
    method: 'POST',
    headers: {
      ...authHeaders(true),
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    handlers.onError?.(await readError(response))
    return
  }
  if (!response.body) {
    handlers.onError?.('No response body from chat stream')
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let turnId = ''
  let sawDone = false

  const dispatch = (event: string, data: string) => {
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(data) as Record<string, unknown>
    } catch {
      // Ignore non-JSON keepalives / partials that somehow framed.
      return
    }
    if (event === 'user') {
      const msg = parsed.message as ChatMessageDto | undefined
      const tid = typeof parsed.turnId === 'string' ? parsed.turnId : ''
      if (tid) turnId = tid
      if (msg) handlers.onUser?.(msg, turnId)
      return
    }
    if (event === 'assistant_start') {
      const tid = typeof parsed.turnId === 'string' ? parsed.turnId : turnId
      if (tid) turnId = tid
      handlers.onAssistantStart?.(turnId)
      return
    }
    if (event === 'token') {
      const text = typeof parsed.text === 'string' ? parsed.text : ''
      if (text) handlers.onToken(text)
      return
    }
    if (event === 'error') {
      const message = typeof parsed.message === 'string' ? parsed.message : 'Chat stream error'
      handlers.onError?.(message)
      return
    }
    if (event === 'message_done') {
      sawDone = true
      const msg = parsed.message as ChatMessageDto | undefined
      const tid = typeof parsed.turnId === 'string' ? parsed.turnId : turnId
      if (msg) handlers.onDone(msg, tid)
    }
  }

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel()
        break
      }
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      buffer = consumeSseBuffer(buffer, { onEvent: dispatch })
    }
    // Flush any trailing decoded text (rare; usually ends with \n\n).
    buffer += decoder.decode()
    buffer = consumeSseBuffer(buffer, { onEvent: dispatch })
    if (!sawDone && !signal?.aborted) {
      handlers.onError?.('Chat stream ended before the assistant finished')
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return
    handlers.onError?.(e instanceof Error ? e.message : 'Chat stream failed')
  }
}

