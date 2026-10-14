import type { RepoDefinition } from './defaults.ts'
import { githubRepoSlug } from './defaults.ts'

export interface RepositoryRecommendation {
  rationale: string
  repositories: RepoDefinition[]
  repositoryModel?: string
}

function asRepoRow(raw: unknown): RepoDefinition | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = String(row.id || '').trim()
  const name = String(row.name || '').trim()
  if (!id || !name) return null
  return {
    id,
    name,
    purpose: String(row.purpose || 'Service').trim(),
    description: String(row.description || '').trim(),
    owner: String(row.owner || '').trim(),
    dependencies: String(row.dependencies || '').trim(),
  }
}

function repoRowIsWorkspace(row: Pick<RepoDefinition, 'id' | 'name' | 'purpose'>): boolean {
  const blob = `${row.id} ${row.name} ${row.purpose}`.toLowerCase()
  return blob.includes('workspace')
}

function mergedDescription(parts: RepoDefinition[], fallback: string): string {
  const bits = parts.map((item) => item.description.trim()).filter(Boolean)
  if (bits.length) return bits.join(' ').slice(0, 500)
  const purposes = parts.map((item) => item.purpose.trim()).filter(Boolean)
  if (purposes.length) return `Covers: ${purposes.join(', ')}`.slice(0, 500)
  return fallback
}

/** Align agent roster rows with confirmed Project Shape (same rules as hosted agent). */
export function normalizeRosterToShape(
  rows: RepoDefinition[],
  projectName: string,
  shape: { topology?: string; repositoryModel?: string },
): RepoDefinition[] {
  if (!rows.length) return rows
  const slug = githubRepoSlug(projectName)
  const model = (shape.repositoryModel || 'multi-repo').trim()
  const topology = (shape.topology || '').trim()
  const workspaceRows = rows.filter((row) => repoRowIsWorkspace(row))
  const nonWorkspace = rows.filter((row) => !repoRowIsWorkspace(row))
  const workspace: RepoDefinition = workspaceRows[0] || {
    id: 'workspace',
    name: `${slug}-workspace`,
    purpose: 'Workspace',
    description: 'AI-SDLC workspace for this product',
    owner: '',
    dependencies: '',
  }

  if (model === 'single-repo') {
    const purpose = topology === 'single-app' ? 'Application' : 'Product'
    return [
      workspace,
      {
        id: 'repo-product',
        name: slug,
        purpose,
        description: mergedDescription(nonWorkspace, `Single Git repo delivering ${projectName}`),
        owner: '',
        dependencies: '',
      },
    ]
  }

  if (model === 'monorepo' || model === 'mono-repo') {
    const seed = nonWorkspace[0]
    return [
      workspace,
      {
        id: 'repo-monorepo',
        name: seed?.name?.trim() || `${slug}-monorepo`,
        purpose: 'Monorepo',
        description: mergedDescription(nonWorkspace, `Monorepo packages for ${projectName}`),
        owner: '',
        dependencies: '',
      },
    ]
  }

  if (topology === 'single-app' || topology === 'frontend-only') {
    const purpose = topology === 'single-app' ? 'Application' : 'Frontend'
    const seed = nonWorkspace[0]
    return [
      workspace,
      {
        id: seed?.id?.trim() || 'repo-app',
        name: seed?.name?.trim() || slug,
        purpose,
        description: mergedDescription(nonWorkspace, seed?.description || `${purpose} for ${projectName}`),
        owner: '',
        dependencies: '',
      },
    ]
  }

  return rows
}

export function parseRepositoryRecommendation(
  raw: unknown,
  projectName?: string,
  shape?: { topology?: string; repositoryModel?: string },
): RepositoryRecommendation | null {
  if (!raw || typeof raw !== 'object') return null
  const root = raw as Record<string, unknown>
  const rec = (root.repositoryRecommendation ?? root) as Record<string, unknown>
  if (!rec || typeof rec !== 'object') return null
  let rows = (Array.isArray(rec.repositories) ? rec.repositories : [])
    .map(asRepoRow)
    .filter((row): row is RepoDefinition => Boolean(row))
  if (!rows.length) return null
  if (projectName && shape?.repositoryModel) {
    rows = normalizeRosterToShape(rows, projectName, shape)
  }
  return {
    rationale: String(rec.rationale || '').trim(),
    repositories: rows,
    repositoryModel: rec.repositoryModel != null ? String(rec.repositoryModel) : undefined,
  }
}
