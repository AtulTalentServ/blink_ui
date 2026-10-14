import type { RepoTechnology } from '../wizard/defaults'
import { isIncompleteRepoTechnology } from '../wizard/shape'
import { loadDeveloperMode } from './storage'

const PREFIX = '[blink:tech-stack]'

export function techStackDebugEnabled(): boolean {
  if (import.meta.env.DEV) return true
  try {
    if (localStorage.getItem('blink.debugTechStack') === '1') return true
  } catch {
    /* ignore */
  }
  return loadDeveloperMode().enabled
}

export function summarizeRepoTechnologyRow(row: RepoTechnology): Record<string, unknown> {
  return {
    repoId: row.repoId,
    status: row.status,
    language: row.language,
    framework: row.framework,
    database: row.database,
    buildTool: row.buildTool,
    incomplete: isIncompleteRepoTechnology(row),
    optionCount: row.technologyOptions?.length ?? 0,
    optionIds: row.technologyOptions?.map((opt) => opt.id) ?? [],
  }
}

export function logTechStack(event: string, detail?: Record<string, unknown>): void {
  if (!techStackDebugEnabled()) return
  if (detail) {
    console.warn(PREFIX, event, detail)
  } else {
    console.warn(PREFIX, event)
  }
}
