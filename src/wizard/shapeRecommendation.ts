import type { ShapeComponent, ShapeProposal } from './types.ts'
import { canonicalRepositoryStructure } from './shape.ts'

export interface ShapeChoiceOption {
  id: string
  label: string
  hint?: string
  benefits?: string[]
  developerDetails?: string
  recommended?: boolean
  custom?: boolean
}

export type ShapeRecommendationSectionId =
  | 'topology'
  | 'repositoryModel'
  | 'architectureStyle'

/** Sections shown on Project Shape (platform/IDE are configured elsewhere). */
export const PROJECT_SHAPE_SECTION_IDS: ReadonlySet<ShapeRecommendationSectionId> = new Set([
  'topology',
  'repositoryModel',
  'architectureStyle',
])

/** Compare wizard state to card option ids (handles mono-repo / multi-repo aliases). */
export function shapeOptionIdMatchesSection(
  sectionId: ShapeRecommendationSectionId,
  selectedId: string | undefined,
  optionId: string,
): boolean {
  const a = (selectedId || '').trim()
  const b = optionId.trim()
  if (!a || !b) return false
  if (sectionId === 'repositoryModel') {
    return canonicalRepositoryStructure(a) === canonicalRepositoryStructure(b)
  }
  return a.toLowerCase() === b.toLowerCase()
}

export interface ShapeRecommendationSection {
  id: ShapeRecommendationSectionId
  title: string
  applicable: boolean
  options: ShapeChoiceOption[]
}

export interface ShapeRecommendation {
  sections: ShapeRecommendationSection[]
  rationale: string
  topology: string
  repositoryModel: string
  architectureStyle: string
  components?: ShapeComponent[]
}

const SECTION_IDS = PROJECT_SHAPE_SECTION_IDS

function asOption(raw: unknown): ShapeChoiceOption | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = String(row.id || '').trim()
  if (!id) return null
  return {
    id,
    label: String(row.label || id),
    hint: row.hint != null ? String(row.hint) : undefined,
    benefits: Array.isArray(row.benefits) ? row.benefits.map(String) : undefined,
    developerDetails: row.developerDetails != null ? String(row.developerDetails) : undefined,
    recommended: row.recommended === true,
    custom: row.custom === true || id === 'custom',
  }
}

export function parseShapeRecommendation(raw: unknown): ShapeRecommendation | null {
  if (!raw || typeof raw !== 'object') return null
  const root = raw as Record<string, unknown>
  const sectionsRaw = Array.isArray(root.sections) ? root.sections : []
  const sections: ShapeRecommendationSection[] = []
  for (const item of sectionsRaw) {
    if (!item || typeof item !== 'object') continue
    const sec = item as Record<string, unknown>
    const id = String(sec.id || '').trim() as ShapeRecommendationSectionId
    if (!SECTION_IDS.has(id)) continue
    const parsed = (Array.isArray(sec.options) ? sec.options : [])
      .map(asOption)
      .filter((opt): opt is ShapeChoiceOption => Boolean(opt))
    const custom = parsed.filter((opt) => opt.custom)
    const concrete = parsed.filter((opt) => !opt.custom).slice(0, 4)
    const options = [...concrete, ...(custom.length ? [custom[0]] : [])]
    sections.push({
      id,
      title: String(sec.title || id),
      applicable: sec.applicable !== false,
      options,
    })
  }
  const topology = String(root.topology || '').trim()
  const repositoryModel = String(root.repositoryModel || '').trim()
  const architectureStyle = String(root.architectureStyle || '').trim()
  if (!topology || !repositoryModel || !architectureStyle) return null
  const components = Array.isArray(root.components)
    ? root.components
        .map((row) => {
          if (!row || typeof row !== 'object') return null
          const c = row as Record<string, unknown>
          const cid = String(c.id || '').trim()
          if (!cid) return null
          return {
            id: cid,
            purpose: String(c.purpose || 'app'),
            description: String(c.description || cid),
          }
        })
        .filter((row): row is ShapeComponent => Boolean(row))
    : undefined
  return {
    sections,
    rationale: String(root.rationale || ''),
    topology,
    repositoryModel,
    architectureStyle,
    ...(components?.length ? { components } : {}),
  }
}

export function shapeProposalFromRecommendation(rec: ShapeRecommendation): ShapeProposal {
  return {
    topology: rec.topology,
    repositoryModel: rec.repositoryModel,
    architectureStyle: rec.architectureStyle,
    rationale: rec.rationale,
    components: rec.components,
  }
}

export function hasUsableShapeRecommendation(rec: ShapeRecommendation | null | undefined): boolean {
  return Boolean(rec?.topology && rec.repositoryModel && rec.architectureStyle)
}
