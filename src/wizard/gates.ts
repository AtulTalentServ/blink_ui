import { confirmCanonicalGate, type CanonicalGateKind } from '../api/blink.ts'
import { patchFromCanonicalSnapshot } from './canonical.ts'
import type { WizardState } from './types.ts'
import { acknowledgeShapePatch, shapeFingerprint } from './shape.ts'

export function groomSessionDigest(state: Pick<WizardState, 'questions' | 'responses' | 'groomDraft'>): string {
  const payload = {
    questions: state.questions.map((q) => ({
      id: q.id,
      mandatory: q.mandatory,
      assignedRoleId: q.assignedRoleId,
    })),
    responses: state.responses.map((r) => ({
      questionId: r.questionId,
      status: r.status,
      response: r.response?.trim() || '',
    })),
    groomDraft: state.groomDraft?.trim() || '',
  }
  return fnv1a(JSON.stringify(payload))
}

export function workPlanPackageDigest(
  state: Pick<
    WizardState,
    'workClassification' | 'specification' | 'technicalPlan' | 'acceptanceCriteriaAcknowledged'
  >,
): string {
  return fnv1a(
    JSON.stringify({
      tier: state.workClassification?.tier,
      spec: state.specification?.markdown?.slice(0, 500),
      plan: state.technicalPlan?.markdown?.slice(0, 500),
      ac: state.acceptanceCriteriaAcknowledged,
    }),
  )
}

export function shapeGateDigest(state: WizardState): string {
  return state.shapeDigest || shapeFingerprint(state)
}

export function repositoryRosterDigest(state: WizardState): string {
  return fnv1a(
    JSON.stringify({
      topology: state.topology,
      repositories: (state.repositories || []).map((r) => ({
        id: r.id,
        name: r.name,
        htmlUrl: r.htmlUrl,
        owner: r.owner,
      })),
    }),
  )
}

/** Lightweight stable digest for gate binding (not cryptographic). */
export async function persistCanonicalGate(
  projectId: string,
  kind: CanonicalGateKind,
  digest: string,
  expectedRevision?: number | null,
) {
  const res = await confirmCanonicalGate(projectId, kind, digest, expectedRevision ?? undefined)
  return patchFromCanonicalSnapshot(res.snapshot)
}

export async function confirmRepositoryRoster(projectId: string, expectedRevision?: number | null) {
  return persistCanonicalGate(projectId, 'repository-roster', '', expectedRevision ?? undefined)
}

export async function confirmAllRepoTechnologies(projectId: string, expectedRevision?: number | null) {
  return persistCanonicalGate(projectId, 'repo-technology-all', '', expectedRevision ?? undefined)
}

export function applyShapeAcknowledgement(state: WizardState): Partial<WizardState> {
  return acknowledgeShapePatch(state)
}

function fnv1a(raw: string): string {
  let hash = 2166136261
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
