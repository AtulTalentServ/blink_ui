/** UI mode on Implementation readiness — batch runner ships in desktop Phase 3. */

import {
  ARCHITECTURE_OPTIONS,
  REPO_MODEL_OPTIONS,
  TOPOLOGY_OPTIONS,
} from './defaults.ts'
import type { WizardState } from './types.ts'

export type ImplementRunMode = 'individual' | 'batch-all'

export const IMPLEMENT_RUN_MODE_KEY = 'blink.implementRunMode'

export function loadImplementRunMode(): ImplementRunMode {
  try {
    const raw = localStorage.getItem(IMPLEMENT_RUN_MODE_KEY)
    if (raw === 'individual' || raw === 'batch-all') return raw
  } catch {
    /* ignore */
  }
  return 'individual'
}

export function saveImplementRunMode(mode: ImplementRunMode): void {
  localStorage.setItem(IMPLEMENT_RUN_MODE_KEY, mode)
}

export interface RequirementsBatchContext {
  text: string
  sourceLabel: string
}

export interface ImplementArchitectureContext {
  markdown: string
  summaryLabel: string
}

function labelForId(options: readonly { id: string; label: string }[], id: string): string {
  const hit = options.find((row) => row.id === id)
  return hit?.label || id || '—'
}

/** Markdown constraints from Project Shape, Repositories, and Technology for Cursor CLI. */
export function implementArchitectureContext(
  state: Pick<
    WizardState,
    | 'projectName'
    | 'topology'
    | 'repositoryModel'
    | 'architectureStyle'
    | 'repositories'
    | 'repoTechnologies'
    | 'topologyConfirmation'
  >,
): ImplementArchitectureContext | null {
  const lines: string[] = [
    '# Blink architecture constraints',
    '',
    'These choices were confirmed in Blink (Project Shape, Repositories, Technology).',
    'Honor them when implementing: repo boundaries, stack per repo, and topology.',
    'If `.cursor/ai-sdlc/` exists in this workspace, prefer it when it agrees with this file.',
    '',
  ]

  const hasShape = Boolean(state.topology?.trim() || state.repositoryModel?.trim() || state.architectureStyle?.trim())
  if (hasShape) {
    lines.push('## Project shape', '')
    if (state.topology?.trim()) {
      lines.push(`- **Application topology:** ${labelForId(TOPOLOGY_OPTIONS, state.topology)} (\`${state.topology}\`)`)
    }
    if (state.repositoryModel?.trim()) {
      lines.push(
        `- **Repository model:** ${labelForId(REPO_MODEL_OPTIONS, state.repositoryModel)} (\`${state.repositoryModel}\`)`,
      )
    }
    if (state.architectureStyle?.trim()) {
      lines.push(
        `- **Architecture style:** ${labelForId(ARCHITECTURE_OPTIONS, state.architectureStyle)} (\`${state.architectureStyle}\`)`,
      )
    }
    lines.push('')
  }

  const repos = (state.repositories || []).filter((repo) => repo.name.trim())
  if (repos.length) {
    lines.push('## Repository roster', '')
    for (const repo of repos) {
      lines.push(`### ${repo.name.trim()} (\`${repo.id}\`)`)
      if (repo.purpose?.trim()) lines.push(`- **Role:** ${repo.purpose.trim()}`)
      if (repo.description?.trim()) lines.push(`- **Description:** ${repo.description.trim()}`)
      if (repo.dependencies?.trim()) lines.push(`- **Depends on:** ${repo.dependencies.trim()}`)
      lines.push('')
    }
  }

  const techRows = state.repoTechnologies || []
  const productRepos = repos.filter(
    (repo) =>
      !repo.purpose.toLowerCase().includes('workspace') && !repo.name.toLowerCase().includes('workspace'),
  )
  const primaryRepo = productRepos[0]
  const productStack = primaryRepo ? techRows.find((row) => row.repoId === primaryRepo.id) : undefined
  if (productStack) {
    lines.push('## Product technology stack', '')
    lines.push(`- **Status:** ${productStack.status}`)
    if (productStack.language?.trim()) lines.push(`- **Language:** ${productStack.language.trim()}`)
    if (productStack.framework?.trim()) lines.push(`- **Framework:** ${productStack.framework.trim()}`)
    if (productStack.database?.trim()) lines.push(`- **Database:** ${productStack.database.trim()}`)
    if (productStack.buildTool?.trim()) lines.push(`- **Build / tooling:** ${productStack.buildTool.trim()}`)
    if (productRepos.length > 1) {
      lines.push(`- **Applies to product repos:** ${productRepos.map((repo) => repo.name.trim()).join(', ')}`)
    }
    lines.push('')
  }

  const confirmation = state.topologyConfirmation
  if (confirmation?.confirmedBy?.trim()) {
    lines.push('## Topology confirmation', '')
    lines.push(`- **Confirmed by:** ${confirmation.confirmedBy.trim()}`)
    if (confirmation.structure?.trim()) lines.push(`- **Structure:** ${confirmation.structure.trim()}`)
    lines.push('')
  }

  const body = lines.join('\n').trim()
  const hasContent = hasShape || repos.length > 0 || techRows.length > 0
  if (!hasContent) return null

  const summaryParts: string[] = []
  if (hasShape) summaryParts.push('shape')
  if (repos.length) summaryParts.push(`${repos.length} repo(s)`)
  if (techRows.length) summaryParts.push(`${techRows.length} stack(s)`)

  return {
    markdown: `${body}\n`,
    summaryLabel: summaryParts.join(' · '),
  }
}

/** Text the implement-all batch will use (not Jira tickets). */
export function requirementsBatchContext(state: {
  groomDraft?: string | null
  requirementsText?: string | null
  productScope?: { markdown?: string | null } | null
  description?: string | null
}): RequirementsBatchContext | null {
  if (state.groomDraft?.trim()) {
    return { text: state.groomDraft.trim(), sourceLabel: 'Grooming draft' }
  }
  if (state.requirementsText?.trim()) {
    return { text: state.requirementsText.trim(), sourceLabel: 'Requirements' }
  }
  if (state.productScope?.markdown?.trim()) {
    return { text: state.productScope.markdown.trim(), sourceLabel: 'Product scope' }
  }
  if (state.description?.trim()) {
    return { text: state.description.trim(), sourceLabel: 'Project description' }
  }
  return null
}

export function excerptRequirements(text: string, max = 2400): string {
  if (text.length <= max) return text
  return `${text.slice(0, max).trimEnd()}…`
}
