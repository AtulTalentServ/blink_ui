import {
  defaultDatabaseDrivers,
  defaultDatabaseTypes,
} from '../databaseTypes'
import {
  defaultFrontendAddons,
  defaultFrontendStack,
} from '../frontendTechnologies'
import { defaultLibrariesForLanguage } from '../languageLibraries'
import type {
  BackendFramework,
  BackendLanguage,
  BuildTool,
  ConfigFormat,
  ProjectType,
  SetupForm,
} from '../types'
import {
  DEFAULT_INTEGRATIONS,
  defaultRepoTechnologies,
  defaultRepositories,
  type IntegrationItem,
  type RepoDefinition,
  type RepoTechnology,
  type WorkspaceEntry,
} from './defaults'
import { assignmentsFromRoles, STAKEHOLDER_ROLES } from './stakeholders'

export type WizardStep =
  | 'welcome'
  | 'project-stakeholders'
  | 'integrations'
  | 'requirements'
  | 'stakeholder-qa'
  | 'sdlc-plan'
  | 'project-shape'
  | 'repositories'
  | 'technology-per-repo'
  | 'generation'
  | 'implementation'
  | 'review-pr'
  | 'release'
  /** Legacy ids remapped on resume. */
  | 'sdlc-scope'
  | 'sdlc-planning'
  | 'ide-and-tools'
  | 'platform-delivery'
  | 'review-resolve'
  | 'project-preview'

/** Legacy step ids persisted in drafts / URLs before Q&A merge and spine split. */
export type LegacyWizardStep =
  | 'stakeholder-questions'
  | 'stakeholder-responses'
  | 'sdlc-planning'
  | 'ide-and-tools'
  | 'platform-delivery'
  | 'review-resolve'
  | 'project-preview'

export interface StakeholderAssignment {
  id: string
  roleId: string
  personName: string
  personEmail: string
}

export interface StakeholderQuestion {
  id: string
  question: string
  assignedRoleId: string
  mandatory: boolean
  sent: boolean
  deliveryStatus: 'pending' | 'sent' | 'failed'
  sentAt: string | null
  deliveryMessage: string
  /** From clarify priority — need_clarification maps to mandatory */
  priority?: 'need_clarification' | 'important' | 'suggestion'
  /** Operator proxy answer text, if any */
  proposedAnswer?: string
  /** Matched / chosen Jira issue key for comments */
  jiraIssueKey?: string | null
  jiraIssueUrl?: string | null
  jiraCommentId?: string | null
  jiraCommentStatus?: 'pending' | 'posted' | 'failed' | 'replied' | 'discussion' | 'resolved'
  jiraCommentMessage?: string
  /** Full discussion thread pulled from Jira (child replies under the clarification) */
  jiraThread?: JiraThreadReply[]
  /** Parent clarification comment body (Blink question posted to Jira) */
  jiraParentBody?: string | null
  jiraParentCommentId?: string | null
  /** Optional AI/local digest of the thread */
  jiraThreadSummary?: string | null
  /** Latest reply body pulled from Jira (mirrors last thread item) */
  jiraReplyBody?: string | null
  jiraReplyAuthor?: string | null
  jiraReplyAt?: string | null
  /** Jira comment id of the stakeholder reply (used to delete simulated replies) */
  jiraReplyCommentId?: string | null
  /** True when new thread activity arrived after a resolution */
  jiraThreadStale?: boolean
  queueEmail?: boolean
  queueJira?: boolean
}

export interface JiraThreadReply {
  commentId: string
  body: string
  author?: string | null
  created?: string | null
  parentId?: string | null
}

export interface QuestionResponse {
  questionId: string
  status: 'pending' | 'discussion' | 'answered' | 'failed' | 'cancelled'
  response: string
  receivedAt: string | null
  /** Where the answer came from */
  source?: 'jira' | 'email' | 'proxy' | 'demo' | 'manual' | 'thread' | 'mcq'
  /** Display name of the Jira comment author when sourced from Jira */
  author?: string | null
  jiraIssueKey?: string | null
  jiraCommentId?: string | null
  /** Comment id chosen when resolving from a thread */
  resolvedFromCommentId?: string | null
}

export interface GenerationStep {
  id: string
  label: string
  status: 'pending' | 'running' | 'done' | 'error'
}

export interface GroomOption {
  id: string
  label: string
  description?: string
}

export interface GroomQuestion {
  id: string
  text: string
  subtitle?: string
  options: GroomOption[]
  allowOther: boolean
  allowMultiple?: boolean
  priority: 'need_clarification' | 'important' | 'suggestion'
  /** Canonical role id from LLM / operator override */
  ownerRole?: string
  /** Queue for email after wording (optional band leftovers) */
  queueEmail?: boolean
  /** Queue for Jira comment after tickets exist */
  queueJira?: boolean
}

export interface GroomAnswer {
  questionId: string
  optionId: string
  optionLabel?: string
  otherText?: string
}

export interface EpicSummary {
  id: string
  title: string
  objective?: string
  storyIds?: string[]
}

export interface StorySummary {
  id: string
  epicId?: string
  title: string
  objective?: string
  asA?: string
  iWant?: string
  soThat?: string
  acceptanceCriteria?: string[]
}

export interface ScopeClassification {
  source_scope_level?: string
  status?: string
  reason?: string
  heading_count?: number
  requirement_ref_count?: number
  word_count?: number
  [key: string]: unknown
}

export interface ProductScopeData {
  productId?: string
  proposalDigest?: string
  confirmationDigest?: string
  productScopeRevision?: number
  status?: string
  classification?: ScopeClassification | Record<string, unknown>
  epicIds?: string[]
  storyIds?: string[]
  epics?: EpicSummary[]
  stories?: StorySummary[]
  markdown?: string
}

export interface ScopeOverlayFile {
  path: string
  content: string
}

export interface WorkClassificationState {
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

export interface SpecificationState {
  title?: string
  summary?: string
  acceptanceCriteria?: string[]
  openQuestions?: string[]
  markdown?: string
  issueId?: string
}

export interface TechnicalPlanState {
  summary?: string
  steps?: { id?: string; title?: string; detail?: string }[]
  rollback?: string
  testStrategy?: string
  openQuestions?: string[]
  markdown?: string
  issueId?: string
}

export interface ImplementationExecutionStep {
  id: string
  title: string
  detail: string
  repositoryIds: string[]
  acceptanceCriteria: string[]
  dependencies: string[]
}

export interface ImplementationExecutionPlan {
  issueId: string
  readinessDigest: string
  stage: 'awaiting-cursor-confirmation' | 'ready-for-review' | 'accepted' | 'returned-to-work-plan'
  source: 'approved-technical-plan'
  steps: ImplementationExecutionStep[]
  cursorPlanningReportedAt?: string | null
  acceptedAt?: string | null
}

export type ImplementationStage =
  | 'waiting-to-start'
  | 'preparing'
  | 'implementing'
  | 'waiting-for-user-decision'
  | 'blocked'
  | 'reviewing'
  | 'validation-reported'
  | 'draft-pr-ready'
  | 'complete'

export interface ImplementationProgressReport {
  id: string
  issueId: string
  stage: ImplementationStage
  completedStepId?: string | null
  currentStepId?: string | null
  repositories: { name: string; branch?: string; commits?: string[] }[]
  changedFiles: string[]
  acceptanceCriteriaCovered: string[]
  validation: string[]
  blockers: string[]
  deviations: string[]
  recommendedNextAction: string
  reportedAt: string
  importedAt: string
}

export interface ImplementationResultReview {
  reportId: string
  issueId: string
  readinessDigest: string
  decision: 'accepted' | 'revision-requested'
  feedback: string
  decidedAt: string
}

export interface RegisteredPullRequest {
  id: string
  issueId: string
  url: string
  repository: string
  branch: string
  candidateCommit: string
  provider: string
  registeredAt: string
}

export interface ReviewFinding {
  id: string
  issueId: string
  summary: string
  severity: 'must-fix' | 'advisory'
  status: 'open' | 'resolved'
  createdAt: string
  resolvedAt?: string | null
}

export interface QaEvidence {
  issueId: string
  status: 'not-reported' | 'passed' | 'failed' | 'not-required'
  evidence: string
  reportedAt: string
}

export interface MergeAuthorization {
  issueId: string
  authorizedBy: string
  authorizedAt: string
}

export interface ReleaseClosureState {
  issueId: string
  humanMerge?: {
    mergedBy: string
    mergedAt: string
    evidenceUrl: string
    commit: string
  } | null
  deploymentRequired: boolean
  deployment?: {
    status: 'not-reported' | 'deployed' | 'failed' | 'not-required'
    approvedBy: string
    approvedAt: string
    evidence: string
  } | null
  monitoring?: {
    status: 'not-reported' | 'healthy' | 'blocker'
    evidence: string
    blocker: string
    reportedAt: string
  } | null
  closure?: {
    closedBy: string
    closedAt: string
  } | null
}

export interface WizardState extends SetupForm {
  applicationType: string
  javaVersion: string
  packaging: 'jar' | 'war'
  orm: string
  apiStyle: string
  securityOption: string
  testingFramework: string
  requirementsText: string
  requirementFileName: string | null
  requirementFile: File | null
  projectId: string | null
  stakeholdersCatalogLoaded: boolean
  existingSourceMode: 'none' | 'zip' | 'git' | 'connect'
  gitRepositoryUrl: string
  sourceZipName: string | null
  skipSourceWarning: boolean
  stakeholderAssignments: StakeholderAssignment[]
  sodWarnings: string[]
  governanceStatus: 'idle' | 'preparing' | 'ready' | 'failed'
  questions: StakeholderQuestion[]
  responses: QuestionResponse[]
  questionsSent: boolean
  requirementsAnalyzed: boolean
  topology: string
  repositoryModel: string
  architectureStyle: string
  repositories: RepoDefinition[]
  repositoriesTouched: boolean
  repoTechnologies: RepoTechnology[]
  ideTool: string
  cloudProvider: string
  environments: Record<string, boolean>
  containerization: string
  iac: string
  cicd: string
  secretsManagement: string
  deploymentModel: string
  blueGreenDeploy: boolean
  canaryDeploy: boolean
  integrations: IntegrationItem[]
  generationSteps: GenerationStep[]
  generationComplete: boolean
  downloadFilename: string | null
  downloadStructure: WorkspaceEntry[]
  nextSdlcCommand: string | null
  filesGenerated: number
  generationTimeSec: number
  groomStatus: string | null
  groomMessage: string
  groomQuestions: GroomQuestion[]
  groomAnswers: GroomAnswer[]
  groomDraft: string
  groomOriginal: string
  groomConfirmed: boolean
  setupStatus: string | null
  setupValidated: boolean
  setupIdentitySource: string | null
  setupOverlayCount: number
  setupContextReady: boolean
  setupDeliveryReady: boolean
  productScope?: ProductScopeData | null
  scopeDigest?: string | null
  scopeOverlays?: ScopeOverlayFile[]
  scopeClarifyStatus?: string | null
  scopeQuestions?: GroomQuestion[]
  scopeAnswers?: GroomAnswer[]
  /** Work item selected for the external implementation handoff. */
  implementationIssueId?: string | null
  /** Context fingerprint when implementation readiness was last reviewed. */
  implementationReadinessDigest?: string | null
  /** Tool selected to execute the current implementation handoff. */
  implementationTool?: 'cursor' | null
  /** When the user confirmed that the handoff was opened in the selected tool. */
  implementationHandoffStartedAt?: string | null
  /** Readiness fingerprint associated with the recorded tool handoff. */
  implementationHandoffStartedDigest?: string | null
  /** Reviewable implementation sequence derived from the approved technical plan. */
  implementationExecutionPlan?: ImplementationExecutionPlan | null
  /** Cursor-reported implementation results, retained as an append-only timeline. */
  implementationProgressHistory?: ImplementationProgressReport[]
  /** Human result-review decisions retained separately from Cursor reports. */
  implementationResultReviews?: ImplementationResultReview[]
  /** Provider/draft pull requests explicitly registered for review. */
  registeredPullRequests?: RegisteredPullRequest[]
  /** Review findings retained independently from PR provider data. */
  reviewFindings?: ReviewFinding[]
  /** Human-entered or imported QA evidence; never inferred as passed. */
  qaEvidence?: QaEvidence | null
  /** Human approval to merge; Blink never performs the merge. */
  mergeAuthorization?: MergeAuthorization | null
  /** Human-recorded merge, deployment, monitoring, and closure evidence. */
  releaseClosure?: ReleaseClosureState | null
  workClassification?: WorkClassificationState | null
  specification?: SpecificationState | null
  technicalPlan?: TechnicalPlanState | null
  stakeholderPack?: { issueId?: string; markdown?: string; rolesCovered?: string[]; openQuestions?: string[]; generatedAt?: string } | null
  groomingRevision?: { issueId?: string; revisionNumber?: number; requirementMarkdown?: string; revisionSummaryMarkdown?: string; changesApplied?: string[] } | null
  groomingSignOff?: { issueId?: string; markdown?: string; readyForHumanSignOff?: boolean; blockers?: string[]; openQuestions?: string[]; capturedAt?: string } | null
  /** Stakeholder Q/A fingerprint when pack/revision/sign-off last finished successfully. */
  groomingLoopFeedbackAt?: string | null
  gitWritten?: boolean
  gitApplyCommit?: { sha?: string; url?: string; branch?: string; owner?: string; repo?: string } | null
  implementStep?: { issueId?: string; commitMessage?: string; summary?: string; files?: { path: string; content: string; repoHint?: string }[]; notes?: string[] } | null
  draftPullRequests?: { url?: string; number?: number; branch?: string; owner?: string; repo?: string; sha?: string; kind?: string }[]
  qaValidation?: { issueId?: string; verdict?: string; summary?: string; markdown?: string; draftPrUrl?: string | null } | null
  /** True after user Continues or Refresh-plan on Ship (plan may predate stack). */
  shipPlanAcknowledged?: boolean
  /** Human G-GROOM acknowledgement (not approve-gate). */
  groomAcknowledged?: boolean
  /** Human review that topology, repositories, and stacks are ready for the work plan. */
  shapeAcknowledged?: boolean
  /** Fingerprint of the reviewed shape; plan is cleared when it changes. */
  shapeDigest?: string | null
  /** Wizard sidebar order version. 2 = Shape before Work plan. */
  wizardLayoutVersion?: number
  /** After G-GROOM reject: revision required before a new ack. */
  groomRejectPending?: boolean
  /** Human confirmation of acceptance criteria after /create-spec. */
  acceptanceCriteriaAcknowledged?: boolean
  /** Human /confirm-stakeholders freshness attestation. */
  stakeholdersConfirmed?: boolean
  stakeholdersConfirmationDigest?: string | null
  /** Human G-PLAN acknowledgement (alias kept in sync with shipPlanAcknowledged). */
  planAcknowledged?: boolean
  /** Human G-BOOTSTRAP acknowledgement before physical remotes / implement. */
  bootstrapAcknowledged?: boolean
  /** Explicit IMPLEMENTATION_AUTHORIZED before /implement-step. */
  implementationAuthorized?: boolean
  /** Hosted sdlc-start issue id / story key. */
  sdlcStartIssueId?: string | null
  /** Tier≥2 impact-analysis deferred/skipped in Blink MVP. */
  impactAnalysisSkipped?: boolean
  jiraCreatedIssues?: JiraCreatedIssue[]
  figmaDesign?: FigmaDesignState | null
  designOptions?: DesignOptionsState | null
}

export interface JiraCreatedIssue {
  sourceId?: string
  jiraKey?: string | null
  jiraUrl?: string | null
  url?: string | null
  type?: string
  status?: string
  message?: string
}

export interface FigmaStoryRef {
  id: string
  title: string
}

export interface FigmaJiraRef {
  sourceId: string
  jiraKey: string
}

export interface FigmaScreenBinding {
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

export interface FigmaDesignFile {
  key: string
  name: string
  thumbnailUrl?: string
  lastModified?: string
}

export interface FigmaDesignChange {
  kind?: string
  nodeId?: string
  name?: string
  previousName?: string
  storyId?: string
  jiraKey?: string
  detail?: string
}

export interface FigmaDesignState {
  fileKey?: string
  fileName?: string
  fileUrl?: string
  fileVersion?: string | null
  syncJira?: boolean
  webhookId?: string | null
  webhookStatus?: string | null
  lastSyncedAt?: string | null
  lastSyncSummary?: string | null
  markdown?: string | null
  screens?: FigmaScreenBinding[]
  availableFiles?: FigmaDesignFile[]
  changes?: FigmaDesignChange[]
}

export type DesignLayout = 'linear' | 'hub' | 'split'

export interface DesignOptionScreen {
  id: string
  name: string
  storyId?: string | null
  storyTitle?: string
  purpose?: string
  states?: string[]
}

export interface DesignOption {
  id: string
  name: string
  summary: string
  layout: DesignLayout | string
  screens: DesignOptionScreen[]
  imageUrl?: string
  stitchScreenId?: string
}

export interface DesignOptionsState {
  status?: 'idle' | 'loading' | 'ready' | 'error'
  fingerprint?: string
  chosenId?: string | null
  message?: string
  markdown?: string
  options?: DesignOption[]
}

function defaultStakeholderAssignments(): StakeholderAssignment[] {
  return assignmentsFromRoles(STAKEHOLDER_ROLES)
}

const javaDbTypes = defaultDatabaseTypes()
const javaDbSelected = { ...javaDbTypes, postgresql: true }
const javaLibs = defaultLibrariesForLanguage('java')
const defaultRepos = defaultRepositories('')

export const defaultWizardState: WizardState = {
  projectType: 'new',
  buildTool: 'gradle-groovy',
  backendLanguage: 'java',
  springBootVersion: '3.4.1',
  frontendStack: { ...defaultFrontendStack(), react: true, typescript: true, vite: true },
  frontendLibraries: defaultFrontendAddons(),
  backendFramework: 'java-spring',
  backendLibraries: javaLibs,
  databaseTypes: javaDbSelected,
  databaseDrivers: defaultDatabaseDrivers('java', javaDbSelected),
  projectName: '',
  artifactName: 'blink-app',
  version: '0.1.0',
  description: '',
  configFormat: 'yaml',
  packageNamespace: '',
  pythonPackageName: '',
  baEmail: '',
  poEmail: '',
  securityEmail: '',
  applicationType: 'web-application',
  javaVersion: '21',
  packaging: 'jar',
  orm: 'spring-data-jpa',
  apiStyle: 'rest',
  securityOption: 'spring-security',
  testingFramework: 'junit-mockito',
  requirementsText: '',
  requirementFileName: null,
  requirementFile: null,
  projectId: null,
  stakeholdersCatalogLoaded: false,
  existingSourceMode: 'none',
  gitRepositoryUrl: '',
  sourceZipName: null,
  skipSourceWarning: false,
  stakeholderAssignments: defaultStakeholderAssignments(),
  sodWarnings: [],
  governanceStatus: 'idle',
  questions: [],
  responses: [],
  questionsSent: false,
  requirementsAnalyzed: false,
  topology: 'full-stack',
  repositoryModel: 'multi-repo',
  architectureStyle: 'microservices',
  repositories: defaultRepos,
  repositoriesTouched: false,
  repoTechnologies: defaultRepoTechnologies(defaultRepos),
  ideTool: 'cursor',
  cloudProvider: 'aws',
  environments: { dev: true, qa: true, staging: true, prod: true },
  containerization: 'docker',
  iac: 'terraform',
  cicd: 'github-actions',
  secretsManagement: 'aws-secrets-manager',
  deploymentModel: 'kubernetes-eks',
  blueGreenDeploy: true,
  canaryDeploy: false,
  integrations: DEFAULT_INTEGRATIONS.map((i) => ({ ...i })),
  generationSteps: [],
  generationComplete: false,
  downloadFilename: null,
  downloadStructure: [],
  nextSdlcCommand: null,
  filesGenerated: 0,
  generationTimeSec: 0,
  groomStatus: null,
  groomMessage: '',
  groomQuestions: [],
  groomAnswers: [],
  groomDraft: '',
  groomOriginal: '',
  groomConfirmed: false,
  setupStatus: null,
  setupValidated: false,
  setupIdentitySource: null,
  setupOverlayCount: 0,
  setupContextReady: false,
  setupDeliveryReady: false,
  productScope: null,
  scopeDigest: null,
  scopeOverlays: [],
  scopeClarifyStatus: null,
  scopeQuestions: [],
  scopeAnswers: [],
  implementationIssueId: null,
  implementationReadinessDigest: null,
  implementationTool: null,
  implementationHandoffStartedAt: null,
  implementationHandoffStartedDigest: null,
  implementationExecutionPlan: null,
  implementationProgressHistory: [],
  implementationResultReviews: [],
  registeredPullRequests: [],
  reviewFindings: [],
  qaEvidence: null,
  mergeAuthorization: null,
  releaseClosure: null,
  workClassification: null,
  specification: null,
  technicalPlan: null,
  stakeholderPack: null,
  groomingRevision: null,
  groomingSignOff: null,
  groomingLoopFeedbackAt: null,
  gitWritten: false,
  gitApplyCommit: null,
  implementStep: null,
  draftPullRequests: [],
  qaValidation: null,
  shipPlanAcknowledged: false,
  groomAcknowledged: false,
  shapeAcknowledged: false,
  shapeDigest: null,
  wizardLayoutVersion: 6,
  groomRejectPending: false,
  acceptanceCriteriaAcknowledged: false,
  stakeholdersConfirmed: false,
  stakeholdersConfirmationDigest: null,
  planAcknowledged: false,
  bootstrapAcknowledged: false,
  implementationAuthorized: false,
  sdlcStartIssueId: null,
  impactAnalysisSkipped: false,
  jiraCreatedIssues: [],
  figmaDesign: null,
  designOptions: null,
}

function ideCommandsLabel(ideTool: string): string {
  switch (ideTool) {
    case 'claude-code':
      return 'Claude Code commands installed'
    case 'vscode-claude':
      return 'VS Code + Claude configuration installed'
    case 'vscode-copilot':
      return 'VS Code + Copilot configuration installed'
    default:
      return 'Cursor slash commands installed'
  }
}

export function generationStepDefs(ideTool = 'cursor') {
  return [
    { id: 'overlay', label: 'Canonical AI-SDLC workspace setup created' },
    { id: 'intake', label: 'Canonical requirement intake stored' },
    { id: 'governance', label: 'Governance and setup records generated' },
    { id: 'framework', label: 'Automation SDLC framework installed' },
    { id: 'commands', label: ideCommandsLabel(ideTool) },
    { id: 'package', label: 'Project packaged for download' },
  ]
}

export const GENERATION_STEP_DEFS = generationStepDefs('cursor')

export function wizardToSetupForm(state: WizardState): SetupForm {
  const ba = state.stakeholderAssignments.find((a) => a.roleId === 'business_analyst' || a.roleId === 'ba')
  const po = state.stakeholderAssignments.find((a) => a.roleId === 'product_owner' || a.roleId === 'po')
  const sc = state.stakeholderAssignments.find((a) => a.roleId === 'security_champion' || a.roleId === 'sc')

  return {
    ...state,
    backendLanguage: 'java' as BackendLanguage,
    backendFramework: 'java-spring' as BackendFramework,
    baEmail: ba?.personEmail ?? state.baEmail,
    poEmail: po?.personEmail ?? state.poEmail,
    securityEmail: sc?.personEmail ?? state.securityEmail,
  }
}

export function syncEmailsFromStakeholders(state: WizardState): WizardState {
  const next = { ...state }
  for (const a of state.stakeholderAssignments) {
    if (a.roleId === 'ba' || a.roleId === 'business_analyst') next.baEmail = a.personEmail
    if (a.roleId === 'po' || a.roleId === 'product_owner') next.poEmail = a.personEmail
    if (a.roleId === 'sc' || a.roleId === 'security_champion') next.securityEmail = a.personEmail
  }
  return next
}

export function syncRepositoriesFromArtifact(state: WizardState): WizardState {
  if (state.repositoriesTouched) return state
  const shape = {
    topology: state.topology,
    repositoryModel: state.repositoryModel,
    architectureStyle: state.architectureStyle,
  }
  const repos = defaultRepositories(state.projectName, shape)
  return {
    ...state,
    repositories: repos,
    repoTechnologies: defaultRepoTechnologies(repos, shape),
  }
}

export function computeReadiness(state: WizardState): number {
  let score = 0
  if (state.projectName) score += 10
  if (state.stakeholderAssignments.length >= 2) score += 10
  if (state.groomConfirmed || state.requirementsAnalyzed) score += 15
  if (state.questionsSent) score += 15
  const mandatoryAnswered = state.questions
    .filter((q) => q.mandatory)
    .every((q) => {
      const response = state.responses.find((r) => r.questionId === q.id)
      const text = response?.response?.trim() || q.jiraReplyBody?.trim()
      return response?.status === 'answered' && Boolean(text)
    })
  if (mandatoryAnswered && state.questions.length > 0) score += 15
  const namedRepos = state.repositories.filter((r) => r.name.trim())
  if (namedRepos.length > 0) score += 10
  if (
    state.repoTechnologies.length > 0 &&
    state.repoTechnologies.every((t) => t.status === 'confirmed')
  ) {
    score += 10
  } else if (state.repoTechnologies.some((t) => t.status === 'confirmed' || t.status === 'recommendation')) {
    score += 5
  }
  if (state.ideTool) score += 5
  if (state.cloudProvider && state.cicd) score += 10
  if (Object.values(state.environments || {}).some(Boolean)) score += 5
  if (state.integrations.some((i) => i.connected)) score += 5
  return Math.min(score, 100)
}

export function clearGroomingPatch(): Partial<WizardState> {
  return {
    groomStatus: null,
    groomMessage: '',
    groomQuestions: [],
    groomAnswers: [],
    groomDraft: '',
    groomOriginal: '',
    groomConfirmed: false,
    requirementsAnalyzed: false,
    questions: [],
    responses: [],
    questionsSent: false,
    productScope: null,
    scopeDigest: null,
    scopeOverlays: [],
    scopeClarifyStatus: null,
    scopeQuestions: [],
    scopeAnswers: [],
    implementationIssueId: null,
    implementationReadinessDigest: null,
    implementationTool: null,
    implementationHandoffStartedAt: null,
    implementationHandoffStartedDigest: null,
    implementationExecutionPlan: null,
    implementationProgressHistory: [],
    implementationResultReviews: [],
    registeredPullRequests: [],
    reviewFindings: [],
    qaEvidence: null,
    mergeAuthorization: null,
    releaseClosure: null,
    workClassification: null,
    specification: null,
    technicalPlan: null,
    stakeholderPack: null,
    groomingRevision: null,
    groomingSignOff: null,
    groomingLoopFeedbackAt: null,
    gitWritten: false,
    gitApplyCommit: null,
    implementStep: null,
    draftPullRequests: [],
    qaValidation: null,
    shipPlanAcknowledged: false,
    groomAcknowledged: false,
    groomRejectPending: false,
    acceptanceCriteriaAcknowledged: false,
    stakeholdersConfirmed: false,
    stakeholdersConfirmationDigest: null,
    planAcknowledged: false,
    bootstrapAcknowledged: false,
    implementationAuthorized: false,
    sdlcStartIssueId: null,
    impactAnalysisSkipped: false,
    jiraCreatedIssues: [],
    figmaDesign: null,
    designOptions: null,
  }
}

export type { ProjectType, BuildTool, BackendLanguage, BackendFramework, ConfigFormat, WorkspaceEntry }
