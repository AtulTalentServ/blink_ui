import { useState } from 'react'
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
  const [showRepositoryGuide, setShowRepositoryGuide] = useState(false)
  const planAcknowledged = Boolean(state.planAcknowledged || state.shipPlanAcknowledged)
  const repositoryNames = state.repositories.map((repository) => repository.name.trim()).filter(Boolean)
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
          <p>Plan repositories and download workspace guidance. GitHub changes remain under your control.</p>
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
                  <h3>Confirm repository setup</h3>
                  <p className="muted">Confirm that you will create or connect the repository structure manually.</p>
                </div>
                {state.bootstrapAcknowledged ? <CheckCircle2 className="ok" size={18} /> : null}
              </div>
              <button
                type="button"
                className="primary-btn"
                disabled={Boolean(state.bootstrapAcknowledged)}
                onClick={() => onUpdate({ bootstrapAcknowledged: true })}
              >
                {state.bootstrapAcknowledged ? 'Manual repository setup confirmed' : 'Confirm manual repository setup'}
              </button>
            </article>

            <article className={`card shape-section workspace-screen__card ${repositoriesCreated ? 'is-done' : ''}`}>
              <div className="sdlc-panel__head">
                <FolderGit2 size={18} />
                <div>
                  <h3>Create repositories manually</h3>
                  <p className="muted">Optionally use Blink’s guided handoff, or create repositories outside Blink and return their URLs here.</p>
                </div>
                {repositoriesCreated ? <CheckCircle2 className="ok" size={18} /> : null}
              </div>
              <button
                type="button"
                className="primary-btn"
                disabled={!canExport}
                onClick={() => {
                  setShowRepositoryGuide(true)
                  onExportGithub?.()
                }}
              >
                {exporting ? <Loader2 className="spin" size={16} /> : <ExternalLink size={16} />}
                {exporting ? 'Preparing instructions…' : 'Guide me through GitHub setup'}
              </button>
              {showRepositoryGuide ? (
                <div className="workspace-screen__manual-guide">
                  <p className="muted small">
                    This is optional. Blink does not submit anything to GitHub or use your token to create repositories.
                  </p>
                  {repositoryNames.length ? (
                    <>
                      <p className="muted small">Create these repositories, then paste their URLs back into Blink:</p>
                      <ul className="muted small">
                        {repositoryNames.map((name) => <li key={name}>{name}</li>)}
                      </ul>
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => window.open(`https://github.com/new?name=${encodeURIComponent(repositoryNames[0])}`, '_blank', 'noopener,noreferrer')}
                      >
                        Open GitHub repository form <ExternalLink size={14} aria-hidden />
                      </button>
                    </>
                  ) : (
                    <p className="muted small">Add repository names first, then reopen this guide.</p>
                  )}
                </div>
              ) : null}
              {!repositoriesCreated ? <p className="muted small">Repository URLs are required before the workspace can be reconciled.</p> : null}
            </article>

            <article className={`card shape-section workspace-screen__card ${state.generationComplete ? 'is-done' : ''}`}>
              <div className="sdlc-panel__head">
                <GitBranch size={18} />
                <div>
                  <h3>Download workspace guidance</h3>
                  <p className="muted">Blink does not commit guidance. Download it and apply it locally after framework readiness is available.</p>
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
              Phase 6 will replace this local handoff with framework-authoritative implementation readiness. Do not use Blink to create branches or pull requests.
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
