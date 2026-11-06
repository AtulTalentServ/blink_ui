import type { RepoDefinition, RepoTechnology } from './defaults.ts'
import type { WizardState, WorkMode } from './types.ts'

export interface ParsedGitRemote {
  host: string
  owner: string
  name: string
  htmlUrl: string
  fullName: string
}

export interface BoundExistingRepo {
  name: string
  htmlUrl?: string
  description?: string
  language?: string
  owner?: string
  purpose?: string
}

const GIT_URL =
  /^(?:https?:\/\/|git@)([^/:]+)[:/]([^/]+)\/([^/#?]+?)(?:\.git)?(?:\/)?$/i

export const EXISTING_UNTITLED_NAME = 'Existing project'
export const EXISTING_UNTITLED_DESCRIPTION =
  'Existing application. Name and description will be filled from the bound repository.'

export function isExistingProject(
  state: Pick<WizardState, 'projectType'> | null | undefined,
): boolean {
  return state?.projectType === 'existing'
}

export function isExistingNamePlaceholder(name: string | undefined): boolean {
  const value = (name || '').trim()
  return !value || value === EXISTING_UNTITLED_NAME
}

export function isExistingDescriptionPlaceholder(description: string | undefined): boolean {
  const value = (description || '').trim()
  return !value || value === EXISTING_UNTITLED_DESCRIPTION
}

export function humanizeRepoName(value: string): string {
  const cleaned = value.trim().replace(/\.git$/i, '').split('/').pop() || value
  const words = cleaned.split(/[-_]+/).filter(Boolean)
  if (!words.length) return cleaned
  return words
    .map((word) => {
      if (word.length <= 3 && word === word.toUpperCase()) return word
      if (/^(api|ui|db|ml)$/i.test(word)) return word.toUpperCase()
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

export function identityFromBoundRepos(repos: BoundExistingRepo[]): { projectName: string; description: string } {
  const first = repos.find((repo) => repo.name.trim())
  if (!first) {
    return { projectName: EXISTING_UNTITLED_NAME, description: EXISTING_UNTITLED_DESCRIPTION }
  }
  const names = repos.map((repo) => repo.name.trim()).filter(Boolean)
  return {
    projectName: humanizeRepoName(first.name),
    description:
      first.description?.trim()
      || (names.length > 1
        ? `Existing application bound from ${names.join(', ')}.`
        : `Existing application bound from ${first.htmlUrl || first.name}.`),
  }
}

export function parseGitRemote(raw: string): ParsedGitRemote | null {
  const value = raw.trim()
  if (!value) return null
  const match = value.match(GIT_URL)
  if (!match) return null
  const host = match[1].toLowerCase()
  const owner = match[2]
  const name = match[3].replace(/\.git$/i, '')
  if (!owner || !name) return null
  const htmlUrl = `https://${host}/${owner}/${name}`
  return { host, owner, name, htmlUrl, fullName: `${owner}/${name}` }
}

export function existingSourceModeFor(input: {
  gitUrl?: string
  zipName?: string | null
  folderPath?: string
  connectedRepos?: number
}): WizardState['existingSourceMode'] {
  if ((input.connectedRepos || 0) > 0) return 'connect'
  if (input.gitUrl?.trim()) return 'git'
  if (input.folderPath?.trim()) return 'folder'
  if (input.zipName) return 'zip'
  return 'none'
}

export function inferExistingShape(repoCount: number): Pick<
  WizardState,
  'topology' | 'repositoryModel' | 'architectureStyle'
> {
  if (repoCount <= 1) {
    return { topology: 'full-stack', repositoryModel: 'single-repo', architectureStyle: 'layered' }
  }
  if (repoCount === 2) {
    return { topology: 'full-stack', repositoryModel: 'multi-repo', architectureStyle: 'layered' }
  }
  return {
    topology: 'microservices',
    repositoryModel: 'multi-repo',
    architectureStyle: 'microservices',
  }
}

export function purposeFromLanguage(language?: string): string {
  const value = (language || '').toLowerCase()
  if (/(typescript|javascript|html|css)/.test(value)) return 'Frontend'
  if (/(java|kotlin|go|rust|c#|csharp|python|ruby|php|scala)/.test(value)) return 'Backend'
  if (/(hcl|terraform|dockerfile|shell|makefile)/.test(value)) return 'Infrastructure'
  return 'Application'
}

function techFromLanguage(language?: string): Pick<RepoTechnology, 'language' | 'framework' | 'database' | 'buildTool'> {
  const value = (language || '').trim()
  if (!value) {
    return { language: '', framework: '', database: '—', buildTool: '' }
  }
  const lower = value.toLowerCase()
  if (lower === 'java' || lower === 'kotlin') {
    return { language: value, framework: '', database: '—', buildTool: 'Maven / Gradle' }
  }
  if (lower === 'typescript' || lower === 'javascript') {
    return { language: value, framework: '', database: '—', buildTool: 'npm / Vite' }
  }
  if (lower === 'python') {
    return { language: value, framework: '', database: '—', buildTool: 'pip / uv' }
  }
  if (lower === 'go') {
    return { language: value, framework: '', database: '—', buildTool: 'go' }
  }
  return { language: value, framework: '', database: '—', buildTool: '' }
}

export function boundReposFromState(state: Pick<WizardState, 'repositories' | 'gitRepositoryUrl'>): BoundExistingRepo[] {
  const fromRepos = (state.repositories || [])
    .filter((repo) => repo.name.trim())
    .map((repo) => ({
      name: repo.name.trim(),
      htmlUrl: repo.htmlUrl,
      description: repo.description,
      owner: repo.owner,
      purpose: repo.purpose,
    }))
  if (fromRepos.length) return fromRepos
  const parsed = parseGitRemote(state.gitRepositoryUrl || '')
  if (!parsed) return []
  return [{ name: parsed.name, htmlUrl: parsed.htmlUrl, owner: parsed.owner, purpose: 'Application' }]
}

export function toBoundRepoDefinitions(repos: BoundExistingRepo[]): RepoDefinition[] {
  const seen = new Set<string>()
  const definitions: RepoDefinition[] = []
  repos.forEach((repo, index) => {
    const name = repo.name.trim()
    const key = (repo.htmlUrl || name).toLowerCase()
    if (!name || seen.has(key)) return
    seen.add(key)
    definitions.push({
      id: `existing-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || String(index)}`,
      name,
      purpose: repo.purpose || purposeFromLanguage(repo.language),
      description: repo.description || '',
      owner: repo.owner || '',
      dependencies: '',
      ...(repo.htmlUrl
        ? { htmlUrl: repo.htmlUrl, createStatus: 'exists', createMessage: 'Bound existing remote' }
        : {}),
    })
  })
  return definitions
}

export function technologiesForBoundRepos(
  repos: RepoDefinition[],
  languages: Record<string, string | undefined> = {},
): RepoTechnology[] {
  return repos.map((repo) => {
    const inferred = techFromLanguage(languages[repo.id] || languages[repo.name])
    return {
      repoId: repo.id,
      language: inferred.language,
      framework: inferred.framework,
      database: inferred.database,
      buildTool: inferred.buildTool,
      status: inferred.language ? 'recommendation' : 'tbd',
    }
  })
}

export function existingProjectBound(
  state: Pick<WizardState, 'projectType' | 'repositories' | 'gitRepositoryUrl' | 'localFolderPath' | 'existingSourceMode'>,
): boolean {
  if (!isExistingProject(state)) return false
  if ((state.repositories || []).some((repo) => repo.name.trim() && (repo.htmlUrl || repo.createStatus === 'exists'))) {
    return true
  }
  if (parseGitRemote(state.gitRepositoryUrl || '')) return true
  if (state.existingSourceMode === 'folder' && state.localFolderPath?.trim()) return true
  return false
}

export function existingDeliveryReady(
  state: Pick<WizardState, 'repositories' | 'gitRepositoryUrl' | 'existingSourceMode'>,
): boolean {
  return (state.repositories || []).some((repo) => Boolean(repo.htmlUrl?.trim()))
    || Boolean(parseGitRemote(state.gitRepositoryUrl || ''))
}

export function validateExistingSource(state: WizardState): string | null {
  if (!isExistingProject(state)) return null
  if (existingProjectBound(state) && existingDeliveryReady(state)) return null
  if (state.sourceZipName && !existingDeliveryReady(state)) {
    return 'A ZIP is only for analysis. Add a Git URL or pick a GitHub repository before continuing.'
  }
  if (state.localFolderPath?.trim() && !existingDeliveryReady(state)) {
    return 'Add the Git remote for this folder so Blink can open pull requests against it.'
  }
  return 'Bind at least one existing GitHub repository or Git URL.'
}

export function existingChangeBrief(input: {
  workMode?: WorkMode
  repos: BoundExistingRepo[]
}): string {
  const names = input.repos.map((repo) => repo.name.trim()).filter(Boolean)
  const label = names.length ? names.join(', ') : 'the bound application'
  if (input.workMode === 'modernization') {
    return `Modernization of ${label}.\n\nCurrent system:\n- \n\nTarget outcome:\n- \n\nConstraints (compatibility, data, downtime):\n- \n`
  }
  return `Maintenance on ${label}.\n\nWhat needs to change:\n- \n\nCurrent behavior:\n- \n\nExpected behavior:\n- \n`
}

export function isExistingChangeBrief(text: string | undefined): boolean {
  const value = (text || '').trim()
  if (!value) return true
  const seeded =
    (/^Maintenance on /i.test(value) && value.includes('What needs to change:'))
    || (/^Modernization of /i.test(value) && value.includes('Current system:'))
  return seeded && !/^- \S/m.test(value)
}

export function applyExistingBind(
  state: WizardState,
  repos: BoundExistingRepo[],
  extras: Partial<Pick<WizardState, 'gitRepositoryUrl' | 'localFolderPath' | 'sourceZipName' | 'existingSourceMode'>> = {},
): Partial<WizardState> {
  const definitions = toBoundRepoDefinitions(repos)
  const languages: Record<string, string | undefined> = {}
  for (const repo of repos) {
    if (repo.language) languages[repo.name] = repo.language
  }
  const shape = inferExistingShape(definitions.length)
  const identity = identityFromBoundRepos(repos)
  const gitUrl = extras.gitRepositoryUrl ?? state.gitRepositoryUrl
  const folder = extras.localFolderPath ?? state.localFolderPath
  const zipName = extras.sourceZipName === undefined ? state.sourceZipName : extras.sourceZipName
  return {
    ...shape,
    projectName: isExistingNamePlaceholder(state.projectName) ? identity.projectName : state.projectName,
    description: isExistingDescriptionPlaceholder(state.description) ? identity.description : state.description,
    gitRepositoryUrl: gitUrl,
    localFolderPath: folder,
    sourceZipName: zipName,
    existingSourceMode: extras.existingSourceMode
      || existingSourceModeFor({
        gitUrl,
        zipName,
        folderPath: folder,
        connectedRepos: definitions.filter((repo) => repo.htmlUrl).length,
      }),
    repositories: definitions,
    repoTechnologies: technologiesForBoundRepos(definitions, languages),
    repositoriesTouched: true,
    repoTechnologiesSuggested: definitions.some((repo) => Boolean(languages[repo.name])),
    setupValidated: true,
    setupIdentitySource: definitions[0]?.htmlUrl || gitUrl || folder || zipName || 'existing',
    setupOverlayCount: Math.max(state.setupOverlayCount || 0, 1),
    setupContextReady: definitions.length > 0 || Boolean(parseGitRemote(gitUrl) || folder.trim()),
    setupDeliveryReady: definitions.some((repo) => Boolean(repo.htmlUrl)) || Boolean(parseGitRemote(gitUrl)),
    bootstrapAcknowledged: true,
    shapeAcknowledged: state.workMode === 'modernization' ? state.shapeAcknowledged : true,
    requirementsText: isExistingChangeBrief(state.requirementsText)
      ? existingChangeBrief({ workMode: state.workMode, repos })
      : state.requirementsText,
  }
}
