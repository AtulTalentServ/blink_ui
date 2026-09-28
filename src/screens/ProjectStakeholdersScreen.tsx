import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { configureStakeholders, confirmStakeholders, fetchStakeholderRoles } from '../api/blink'
import { ConfirmDialog } from '../components/ConfirmDialog'
import {
  STAKEHOLDER_ROLES,
  assignmentsFromRoles,
  roleLabel,
  type StakeholderRoleDef,
} from '../wizard/stakeholders'
import { LOGIN_ALLOWED_DOMAIN } from '../auth/session'
import { syncRepositoriesFromArtifact, type WizardState } from '../wizard/types'

interface Props {
  state: WizardState
  onUpdate: (patch: Partial<WizardState>) => void
}

/** Matches backend ProjectRequest @Size limits. */
export const PROJECT_NAME_MAX = 255
export const PROJECT_DESCRIPTION_MAX = 8000

/** Show character count only when the field is getting long. */
const NAME_COUNT_SHOW_AT = Math.floor(PROJECT_NAME_MAX * 0.85)
const DESC_COUNT_SHOW_AT = Math.floor(PROJECT_DESCRIPTION_MAX * 0.9)

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-')
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function avatarTone(name: string): number {
  const seed = name.trim() || '?'
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash + seed.charCodeAt(i)) % 6
  return hash
}

function toRoleDef(role: StakeholderRoleDef): StakeholderRoleDef {
  return {
    id: role.id,
    label: role.label,
    defaultName: role.defaultName,
    defaultEmail: role.defaultEmail,
  }
}

export function ProjectStakeholdersScreen({ state, onUpdate }: Props) {
  const [roles, setRoles] = useState<StakeholderRoleDef[]>(STAKEHOLDER_ROLES)
  const [catalogQuiet, setCatalogQuiet] = useState<string | null>('Loading directory…')
  const [removeTarget, setRemoveTarget] = useState<{ id: string; label: string } | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const dirtyRef = useRef(false)
  const catalogLoadedRef = useRef(state.stakeholdersCatalogLoaded)
  const assignmentsRef = useRef(state.stakeholderAssignments)
  catalogLoadedRef.current = state.stakeholdersCatalogLoaded
  assignmentsRef.current = state.stakeholderAssignments

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const remote = await fetchStakeholderRoles()
        if (cancelled) return
        const mapped = remote.map((role) =>
          toRoleDef({
            id: role.roleCode,
            label: role.roleName,
            defaultName: role.defaultName,
            defaultEmail: role.defaultEmail,
          }),
        )
        setRoles(mapped.length ? mapped : STAKEHOLDER_ROLES)
        setCatalogQuiet(null)
        if (!dirtyRef.current && !catalogLoadedRef.current) {
          onUpdate({
            stakeholderAssignments: assignmentsFromRoles(mapped.length ? mapped : STAKEHOLDER_ROLES),
            stakeholdersCatalogLoaded: true,
          })
        } else if (!catalogLoadedRef.current) {
          onUpdate({ stakeholdersCatalogLoaded: true })
        }
      } catch {
        if (cancelled) return
        setRoles(STAKEHOLDER_ROLES)
        setCatalogQuiet(null)
        const catalogIds = new Set(STAKEHOLDER_ROLES.map((role) => role.id))
        const stale = assignmentsRef.current.some((row) => !catalogIds.has(row.roleId))
        if (!dirtyRef.current && (stale || assignmentsRef.current.length === 0) && !catalogLoadedRef.current) {
          onUpdate({
            stakeholderAssignments: assignmentsFromRoles(STAKEHOLDER_ROLES),
            stakeholdersCatalogLoaded: true,
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [onUpdate])

  const updateField = <K extends keyof WizardState>(key: K, value: WizardState[K]) => {
    let patch: Partial<WizardState> = { [key]: value }
    if (key === 'projectName' && typeof value === 'string') {
      const artifact = slugify(value)
      patch = { ...patch, artifactName: artifact, packageNamespace: `com.${artifact.replace(/-/g, '')}.backend` }
      patch = syncRepositoriesFromArtifact({ ...state, ...patch } as WizardState)
    }
    onUpdate(patch)
  }

  const updateRow = (id: string, field: 'roleId' | 'personName' | 'personEmail', value: string) => {
    dirtyRef.current = true
    onUpdate({
      stakeholdersConfirmed: false,
      stakeholdersConfirmationDigest: null,
      stakeholderAssignments: state.stakeholderAssignments.map((a) => {
        if (a.id !== id) return a
        if (field !== 'roleId') return { ...a, [field]: value }
        const directory = roles.find((role) => role.id === value)
        return {
          ...a,
          roleId: value,
          personName: a.personName.trim() || directory?.defaultName || '',
          personEmail: a.personEmail.trim() || directory?.defaultEmail || '',
        }
      }),
    })
  }

  const addRow = () => {
    dirtyRef.current = true
    const fallback = roles[0] ?? STAKEHOLDER_ROLES[0]
    onUpdate({
      stakeholdersConfirmed: false,
      stakeholdersConfirmationDigest: null,
      stakeholderAssignments: [
        ...state.stakeholderAssignments,
        {
          id: `sa-${Date.now()}`,
          roleId: fallback.id,
          personName: '',
          personEmail: '',
        },
      ],
    })
  }

  const requestRemove = (id: string) => {
    const row = state.stakeholderAssignments.find((a) => a.id === id)
    const label = row?.personName.trim() || (row ? roleLabel(row.roleId) : 'this stakeholder')
    setRemoveTarget({ id, label })
  }

  const confirmRemove = () => {
    if (!removeTarget) return
    dirtyRef.current = true
    onUpdate({
      stakeholderAssignments: state.stakeholderAssignments.filter((a) => a.id !== removeTarget.id),
    })
    setRemoveTarget(null)
  }

  const showNameCount = state.projectName.length >= NAME_COUNT_SHOW_AT
  const showDescCount = state.description.length >= DESC_COUNT_SHOW_AT

  return (
    <div className="screen screen-project">
      <div className="screen-header">
        <h2>Project & Stakeholders</h2>
        <p>Name the project and who should be in the loop.</p>
      </div>

      <section className="card project-setup-card">
        <div className="field-group">
          <div className="field-label-row">
            <label htmlFor="projectName">Project name</label>
            {showNameCount ? (
              <span
                id="projectName-count"
                className={`field-count${state.projectName.length >= PROJECT_NAME_MAX ? ' is-limit' : ''}`}
              >
                {state.projectName.length.toLocaleString()} / {PROJECT_NAME_MAX.toLocaleString()}
              </span>
            ) : null}
          </div>
          <input
            id="projectName"
            placeholder="e.g. Banking Application"
            value={state.projectName}
            maxLength={PROJECT_NAME_MAX}
            aria-describedby={showNameCount ? 'projectName-count' : undefined}
            onChange={(e) => updateField('projectName', e.target.value.slice(0, PROJECT_NAME_MAX))}
          />
        </div>

        <div className="field-group">
          <div className="field-label-row">
            <label htmlFor="description">Short description</label>
            {showDescCount ? (
              <span
                id="description-count"
                className={`field-count${state.description.length >= PROJECT_DESCRIPTION_MAX ? ' is-limit' : ''}`}
              >
                {state.description.length.toLocaleString()} / {PROJECT_DESCRIPTION_MAX.toLocaleString()}
              </span>
            ) : null}
          </div>
          <textarea
            id="description"
            rows={3}
            placeholder="What are we building, in a sentence or two?"
            value={state.description}
            maxLength={PROJECT_DESCRIPTION_MAX}
            aria-describedby={showDescCount ? 'description-count' : undefined}
            onChange={(e) => updateField('description', e.target.value.slice(0, PROJECT_DESCRIPTION_MAX))}
          />
        </div>

        <div className="field-group stakeholder-field">
          <div className="field-label-row">
            <label id="stakeholders-label">Stakeholders</label>
            <button type="button" className="text-btn stakeholder-add" onClick={addRow}>
              <Plus size={14} /> Add stakeholder
            </button>
          </div>

          {catalogQuiet ? <p className="quiet-hint">{catalogQuiet}</p> : null}

          {state.stakeholderAssignments.length === 0 ? (
            <p className="stakeholder-empty">Add at least one stakeholder so Blink knows who to ask.</p>
          ) : (
            <div className="stakeholder-grid" role="group" aria-labelledby="stakeholders-label">
              {state.stakeholderAssignments.map((row) => (
                <div key={row.id} className="stakeholder-grid-row">
                  <span
                    className={`stakeholder-avatar tone-${avatarTone(row.personName || roleLabel(row.roleId))}`}
                    aria-hidden="true"
                  >
                    {initials(row.personName || roleLabel(row.roleId))}
                  </span>
                  <label className="stakeholder-cell">
                    <span className="stakeholder-cell-label">Name</span>
                    <input
                      placeholder="Full name"
                      value={row.personName}
                      aria-label={`Name for ${roleLabel(row.roleId)}`}
                      onChange={(e) => updateRow(row.id, 'personName', e.target.value)}
                    />
                  </label>
                  <label className="stakeholder-cell">
                    <span className="stakeholder-cell-label">Email</span>
                    <input
                      type="email"
                      placeholder={`name@${LOGIN_ALLOWED_DOMAIN}`}
                      value={row.personEmail}
                      aria-label={`Email for ${roleLabel(row.roleId)}`}
                      onChange={(e) => updateRow(row.id, 'personEmail', e.target.value)}
                    />
                  </label>
                  <label className="stakeholder-cell">
                    <span className="stakeholder-cell-label">Role</span>
                    <select
                      value={row.roleId}
                      aria-label={`Role for ${row.personName || 'stakeholder'}`}
                      onChange={(e) => updateRow(row.id, 'roleId', e.target.value)}
                    >
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="icon-btn stakeholder-remove"
                    onClick={() => requestRemove(row.id)}
                    title="Remove"
                    aria-label={`Remove ${row.personName || roleLabel(row.roleId)}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {state.projectId ? (
          <div className="stakeholder-confirm-row">
            {state.stakeholdersConfirmed ? (
              <p className="status-banner success">Stakeholder registry confirmed.</p>
            ) : (
              <>
                <p className="quiet-hint">
                  Save the project, then confirm the registry as an explicit human gate.
                </p>
                {confirmError ? <p className="status-banner error">{confirmError}</p> : null}
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={confirmBusy || Boolean(validateProjectStakeholders(state))}
                  onClick={() => {
                    void (async () => {
                      if (!state.projectId) return
                      setConfirmBusy(true)
                      setConfirmError(null)
                      try {
                        await configureStakeholders(state.projectId)
                        const res = await confirmStakeholders(state.projectId)
                        if (res.status !== 'ok') {
                          throw new Error(res.message || res.errors?.join('; ') || 'Confirm failed')
                        }
                        onUpdate({
                          stakeholdersConfirmed: true,
                          stakeholdersConfirmationDigest: res.confirmationDigest || null,
                          nextSdlcCommand: res.nextCommand || state.nextSdlcCommand,
                        })
                      } catch (err) {
                        setConfirmError(err instanceof Error ? err.message : 'Could not confirm stakeholders.')
                      } finally {
                        setConfirmBusy(false)
                      }
                    })()
                  }}
                >
                  {confirmBusy ? 'Confirming…' : 'Confirm stakeholder registry'}
                </button>
              </>
            )}
          </div>
        ) : null}
      </section>

      {removeTarget && (
        <ConfirmDialog
          title="Remove stakeholder?"
          copy={`Remove ${removeTarget.label} from this project? You can add them again later.`}
          confirmLabel="Remove"
          titleId="remove-stakeholder-title"
          copyId="remove-stakeholder-copy"
          onCancel={() => setRemoveTarget(null)}
          onConfirm={confirmRemove}
        />
      )}
    </div>
  )
}

export function validateProjectStakeholders(state: WizardState): string | null {
  if (!state.projectName.trim()) return 'Project name is required.'
  if (state.projectName.length > PROJECT_NAME_MAX) {
    return `Project name can be at most ${PROJECT_NAME_MAX.toLocaleString()} characters.`
  }
  if (!state.description.trim()) return 'Project description is required.'
  if (state.description.length > PROJECT_DESCRIPTION_MAX) {
    return `Project description can be at most ${PROJECT_DESCRIPTION_MAX.toLocaleString()} characters.`
  }
  if (state.stakeholderAssignments.length === 0) return 'Add at least one stakeholder.'
  const missing = state.stakeholderAssignments.find((a) => !a.personEmail.trim() || !a.personName.trim())
  if (missing) return 'Every stakeholder must have a name and email.'
  return null
}
