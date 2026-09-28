import { CheckCircle2, ChevronLeft, Download, ExternalLink, FolderGit2, GitBranch, Loader2 } from 'lucide-react'
import type { WizardState, WizardStep } from '../wizard/types'

interface Props {
  state: WizardState
  onUpdate: (patch: Partial<WizardState>) => void
  loading: boolean
  exporting?: boolean
  onExportGithub?: () => void
  onGenerateKit?: () => void
  onNavigate: (step: WizardStep) => void
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
  onBack,
}: Props) {
  const planAcknowledged = Boolean(state.planAcknowledged || state.shipPlanAcknowledged)
  const repositoriesCreated = state.repositories.some(
    (repository) => Boolean(repository.htmlUrl),
  )
  const canExport = planAcknowledged && state.bootstrapAcknowledged && !exporting

  return (
    <div className="screen shape-screen workspace-screen">
      <div className="screen-header">
        <div>
          <p className="shape-kicker">Workspace</p>
          <h2>Prepare the workspace for Cursor</h2>
          <p>Confirm the planned repository setup, then let Blink create and connect the configured GitHub repositories.</p>
        </div>
      </div>

      {!planAcknowledged ? (
        <section className="card shape-section">
          <h3>Finish the Work plan first</h3>
          <p className="muted">
            Review and acknowledge the technical plan before preparing repositories and workspace guidance.
          </p>
          <button type="button" className="secondary-btn" onClick={() => onNavigate('sdlc-plan')}>
            Go to Work plan <ExternalLink size={14} aria-hidden />
          </button>
        </section>
      ) : (
        <>
          <section className="workspace-screen__grid">
            <article className={`card shape-section workspace-screen__card ${state.bootstrapAcknowledged ? 'is-done' : ''}`}>
              <div className="sdlc-panel__head">
                <GitBranch size={18} />
                <div>
                  <h3>Authorize repository setup</h3>
                  <p className="muted">Confirm the planned repository structure before Blink creates the configured GitHub repositories.</p>
                </div>
                {state.bootstrapAcknowledged ? <CheckCircle2 className="ok" size={18} /> : null}
              </div>
              <button
                type="button"
                className="primary-btn"
                disabled={Boolean(state.bootstrapAcknowledged)}
                onClick={() => onUpdate({ bootstrapAcknowledged: true })}
              >
                {state.bootstrapAcknowledged ? 'Repository setup authorized' : 'Authorize repository setup'}
              </button>
            </article>

            <article className={`card shape-section workspace-screen__card ${repositoriesCreated ? 'is-done' : ''}`}>
              <div className="sdlc-panel__head">
                <FolderGit2 size={18} />
                <div>
                  <h3>Create GitHub repositories</h3>
                  <p className="muted">Blink creates the configured repositories and records their remote URLs here.</p>
                </div>
                {repositoriesCreated ? <CheckCircle2 className="ok" size={18} /> : null}
              </div>
              <button
                type="button"
                className="primary-btn"
                disabled={!canExport}
                onClick={() => onExportGithub?.()}
              >
                {exporting ? <Loader2 className="spin" size={16} /> : <GitBranch size={16} />}
                {exporting ? 'Creating repositories…' : repositoriesCreated ? 'Reconcile GitHub repositories' : 'Create GitHub repositories'}
              </button>
              {!repositoriesCreated ? <p className="muted small">Connect GitHub on Integrations before creating repositories.</p> : null}
            </article>

            <article className={`card shape-section workspace-screen__card ${state.generationComplete ? 'is-done' : ''}`}>
              <div className="sdlc-panel__head">
                <GitBranch size={18} />
                <div>
                  <h3>Download workspace guidance</h3>
                  <p className="muted">Generate and download workspace guidance after framework readiness is available.</p>
                </div>
                {state.generationComplete ? <CheckCircle2 className="ok" size={18} /> : null}
              </div>
              <button type="button" className="primary-btn" disabled={loading} onClick={() => onGenerateKit?.()}>
                <Download size={16} />
                {state.generationComplete ? 'Download updated guidance' : 'Generate workspace guidance'}
              </button>
              {!state.scopeOverlays?.length ? (
                <p className="muted small">Generate the workspace kit before downloading the workspace guidance.</p>
              ) : null}
            </article>
          </section>

          <section className="card shape-section workspace-screen__next">
            <h3>Next: Implementation</h3>
            <p className="muted">
              Continue once Blink has created the repositories and prepared the workspace guidance.
            </p>
            <button type="button" className="secondary-btn" onClick={() => onNavigate('implementation')}>
              Go to Implementation <ExternalLink size={14} aria-hidden />
            </button>
          </section>
        </>
      )}

      <section className="card shape-section workspace-screen__kit">
        <div className="sdlc-panel__head">
          <Download size={18} />
          <div>
            <h3>Optional workspace kit</h3>
            <p className="muted">Download the generated workspace as a local reference or backup.</p>
          </div>
        </div>
        <button type="button" className="ghost-btn" disabled={loading} onClick={() => onGenerateKit?.()}>
          <Download size={14} /> {state.generationComplete ? 'Download workspace kit again' : 'Generate workspace kit'}
        </button>
      </section>

      {onBack ? (
        <button type="button" className="back-dashboard" onClick={onBack}>
          <ChevronLeft size={14} /> Back to Dashboard
        </button>
      ) : null}
    </div>
  )
}
