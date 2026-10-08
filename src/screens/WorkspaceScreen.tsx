import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ChevronLeft, Download, ExternalLink, FolderGit2, Loader2, Sparkles } from 'lucide-react'
import { fetchCanonicalSnapshot, gitApply, pauseAutosave, shipCheckpoint } from '../api/blink'
import { patchFromCanonicalSnapshot } from '../wizard/canonical'
import type { WizardState, WizardStep } from '../wizard/types'

interface Props {
  state: WizardState
  onUpdate: (patch: Partial<WizardState>) => void
  loading: boolean
  exporting?: boolean
  onExportGithub?: () => void
  onGenerateKit?: () => void
  onNavigate: (step: WizardStep) => void
  onGoImplementation?: () => void
  onBack?: () => void
}

export function WorkspaceScreen({
  state,
  onUpdate,
  loading,
  exporting,
  onExportGithub,
  onGenerateKit,
  onNavigate,
  onGoImplementation,
  onBack,
}: Props) {
  const [applyBusy, setApplyBusy] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  const planAcknowledged = Boolean(state.planAcknowledged || state.shipPlanAcknowledged)
  const githubConnected = state.integrations.some((item) => item.id === 'github' && item.connected)
  const repositoriesCreated = state.repositories.some((repository) => Boolean(repository.htmlUrl))
  const failedRepos = (state.repositories || []).filter(
    (repository) => repository.createStatus === 'failed' || /401|403|failed/i.test(repository.createMessage || ''),
  )
  const guidanceReady = Boolean(state.generationComplete || (state.scopeOverlays || []).length > 0)
  const workspaceReady = Boolean(state.gitWritten)

  // Integrations already connects GitHub — no separate "authorize" click.
  // Auto-ack bootstrap when GitHub is linked or remotes already exist.
  useEffect(() => {
    if (!planAcknowledged || state.bootstrapAcknowledged) return
    if (githubConnected || repositoriesCreated) {
      onUpdate({ bootstrapAcknowledged: true })
    }
  }, [planAcknowledged, state.bootstrapAcknowledged, githubConnected, repositoriesCreated, onUpdate])

  const canCreateRepos = planAcknowledged && (state.bootstrapAcknowledged || githubConnected) && !exporting

  const prepareWorkspace = useCallback(async () => {
    if (!state.projectId) {
      setApplyError('Save the project first.')
      return
    }
    const projectId = state.projectId
    const overlays = state.scopeOverlays || []
    setApplyError(null)
    pauseAutosave(120_000)
    // Local unlock first — Neon ship/git-apply must not hold "Preparing…".
    onUpdate({ gitWritten: true, bootstrapAcknowledged: true })
    setApplyBusy(false)
    void (async () => {
      try {
        if (overlays.length > 0) {
          try {
            const res = await gitApply(projectId, {
              confirm: true,
              overlayFiles: overlays,
              repositories: state.repositories.map((r) => ({
                name: r.name,
                htmlUrl: r.htmlUrl,
                purpose: r.purpose,
              })),
              issueKey: state.sdlcStartIssueId || undefined,
            })
            if (res.status === 'ok' || res.gitWritten) {
              onUpdate({
                gitWritten: true,
                gitApplyCommit: res.commit || state.gitApplyCommit,
                scopeOverlays: res.overlayFiles || overlays,
                bootstrapAcknowledged: true,
              })
              const snap = await fetchCanonicalSnapshot(projectId).catch(() => null)
              if (snap) {
                onUpdate(patchFromCanonicalSnapshot(snap, {
                  ...state,
                  gitWritten: true,
                  shipSubstage: state.shipSubstage || 'workspace',
                }))
              }
              return
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            if (!/github|overlay_empty|workspace_repo|timed out|busy|timeout/i.test(msg)) {
              throw err
            }
          }
        }
        await shipCheckpoint(projectId, {
          substage: 'workspace',
          stepKind: 'git-apply',
          idempotencyKey: `git-apply-local-${projectId}`,
          payload: {
            source: 'workspace-screen',
            local: true,
            overlays: overlays.length,
            generationComplete: state.generationComplete,
          },
        })
        const snap = await fetchCanonicalSnapshot(projectId).catch(() => null)
        if (snap) {
          onUpdate(patchFromCanonicalSnapshot(snap, {
            ...state,
            gitWritten: true,
            shipSubstage: state.shipSubstage || 'workspace',
          }))
        }
      } catch (err) {
        // Soft: workspace already marked ready locally.
        setApplyError(err instanceof Error ? err.message : 'Could not sync workspace checkpoint yet.')
      }
    })()
  }, [onUpdate, state])

  return (
    <div className="screen shape-screen workspace-screen">
      {!planAcknowledged ? (
        <section className="card shape-section">
          <h3>Finish the Work plan first</h3>
          <p className="muted">Acknowledge the technical plan, then return here.</p>
          <button type="button" className="secondary-btn" onClick={() => onNavigate('sdlc-plan')}>
            Go to Work plan <ExternalLink size={14} aria-hidden />
          </button>
        </section>
      ) : (
        <>
          <ul className="workspace-steps">
            <li className={`workspace-step${repositoriesCreated ? ' is-done' : ''}`}>
              <div className="workspace-step__head">
                {repositoriesCreated ? <CheckCircle2 size={18} className="ok" /> : <FolderGit2 size={18} />}
                <div>
                  <h3>GitHub remotes</h3>
                  <p className="muted">
                    {githubConnected
                      ? 'GitHub is connected from Integrations. Create remotes here only if they are not on GitHub yet.'
                      : 'Connect GitHub on Integrations first. You can still mark the workspace ready locally.'}
                  </p>
                </div>
              </div>

              {(state.repositories || []).length ? (
                <ul className="workspace-step__repos">
                  {(state.repositories || []).map((repo) => (
                    <li key={repo.id}>
                      <code>{repo.name || 'unnamed'}</code>
                      <span className="muted small">
                        {repo.htmlUrl ? 'on GitHub' : repo.createMessage || repo.createStatus || 'Local only'}
                      </span>
                      {repo.htmlUrl ? (
                        <a href={repo.htmlUrl} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">No repositories configured yet — add them on Repositories.</p>
              )}

              <div className="workspace-step__actions">
                {!repositoriesCreated || failedRepos.length ? (
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={!canCreateRepos || !githubConnected}
                    onClick={() => onExportGithub?.()}
                  >
                    {exporting ? <Loader2 className="spin" size={16} /> : null}
                    {exporting
                      ? 'Creating…'
                      : failedRepos.length
                        ? `Retry failed (${failedRepos.length})`
                        : 'Create on GitHub'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={!canCreateRepos || !githubConnected}
                    onClick={() => onExportGithub?.()}
                  >
                    {exporting ? <Loader2 className="spin" size={16} /> : null}
                    Reconcile remotes
                  </button>
                )}
                {!githubConnected ? (
                  <button type="button" className="secondary-btn" onClick={() => onNavigate('integrations')}>
                    Open Integrations
                  </button>
                ) : null}
              </div>
            </li>

            <li className={`workspace-step${guidanceReady ? ' is-done' : ''}`}>
              <div className="workspace-step__head">
                {guidanceReady ? <CheckCircle2 size={18} className="ok" /> : <Download size={18} />}
                <div>
                  <h3>Workspace guidance</h3>
                  <p className="muted">
                    Overlay kit for Cursor and the implementation agent. Often already filled from Work plan scope.
                  </p>
                </div>
              </div>
              <div className="workspace-step__actions">
                <button
                  type="button"
                  className={guidanceReady ? 'ghost-btn' : 'primary-btn'}
                  disabled={loading}
                  onClick={() => onGenerateKit?.()}
                >
                  {loading ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
                  {guidanceReady ? 'Refresh guidance' : 'Generate guidance'}
                </button>
              </div>
            </li>

            <li className={`workspace-step${workspaceReady ? ' is-done' : ''}`}>
              <div className="workspace-step__head">
                {workspaceReady ? <CheckCircle2 size={18} className="ok" /> : <Sparkles size={18} />}
                <div>
                  <h3>Ready for Implementation</h3>
                  <p className="muted">
                    Records the workspace ship step and unlocks the Implementation tab.
                  </p>
                </div>
              </div>
              {applyError ? <p className="sdlc-timeline__outcome is-blocked">{applyError}</p> : null}
              <div className="workspace-step__actions">
                {workspaceReady ? (
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => (onGoImplementation ? onGoImplementation() : onNavigate('implementation'))}
                  >
                    Go to Implementation <ExternalLink size={14} aria-hidden />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={applyBusy}
                    onClick={() => void prepareWorkspace()}
                  >
                    {applyBusy ? <Loader2 className="spin" size={16} /> : null}
                    {applyBusy ? 'Preparing…' : 'Mark workspace ready'}
                  </button>
                )}
              </div>
            </li>
          </ul>
        </>
      )}

      {onBack ? (
        <button type="button" className="back-dashboard" onClick={onBack}>
          <ChevronLeft size={14} /> Back to Dashboard
        </button>
      ) : null}
    </div>
  )
}
