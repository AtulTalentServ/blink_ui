import { CheckCircle2, Copy, ExternalLink, Laptop, Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ImplementationHandoff } from '../wizard/implementationHandoff'
import type { WizardState } from '../wizard/types'

interface Props {
  state: WizardState
  handoff: ImplementationHandoff | null
  markdown: string
  onUpdate: (patch: Partial<WizardState>) => void
}

function cursorInstruction(handoff: ImplementationHandoff, markdown: string): string {
  return [
    `Implement ${handoff.workItem.id}: ${handoff.workItem.title}.`,
    '',
    'Read the Blink handoff below before changing code. Inspect the listed repositories and their existing conventions.',
    'Run /sdlc-next and follow its stage guidance. Work only on the selected item and its acceptance criteria.',
    'Use the suggested feature branch in each repository. Report blockers instead of bypassing them.',
    'When complete, return the branch, changed repositories, validation performed, and any blockers to Blink.',
    '',
    '--- Blink handoff ---',
    markdown,
  ].join('\n')
}

export function CursorLaunchPanel({ state, handoff, markdown, onUpdate }: Props) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(Boolean(state.implementationTool === 'cursor'))
  const instruction = useMemo(
    () => (handoff ? cursorInstruction(handoff, markdown) : ''),
    [handoff, markdown],
  )
  const workspace = handoff?.repositories.find(
    (repository) => repository.purpose.toLowerCase() === 'workspace' || repository.name.endsWith('-workspace'),
  )
  const productRepositories = handoff?.repositories.filter((repository) => repository !== workspace) || []
  const startedAt =
    state.implementationHandoffStartedDigest === state.implementationReadinessDigest
      ? state.implementationHandoffStartedAt
      : null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(instruction)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  if (!handoff) return null

  return (
    <section className="card shape-section cursor-launch">
      <div className="sdlc-panel__head">
        <Laptop size={18} />
        <div>
          <h3>Use Cursor</h3>
          <p className="muted">
            Blink has prepared the context. Cursor implements the work; Blink records the handoff and receives the
            outcome later.
          </p>
        </div>
      </div>

      {!open ? (
        <button
          type="button"
          className="primary-btn"
          onClick={() => {
            setOpen(true)
            onUpdate({ implementationTool: 'cursor' })
          }}
        >
          <Play size={15} /> Use Cursor
        </button>
      ) : (
        <>
          <div className="cursor-launch__status">
            <CheckCircle2 size={17} aria-hidden />
            <span>Cursor selected for {handoff.workItem.id}</span>
          </div>

          <div className="cursor-launch__grid">
            <section>
              <h4>Open these repositories</h4>
              <p className="muted small">
                {workspace
                  ? `Open ${workspace.name} first so Cursor can read the workspace guidance.`
                  : 'Open the implementation repositories below.'}
              </p>
              <ul className="cursor-launch__repositories">
                {workspace ? <li><strong>{workspace.name}</strong> — workspace guidance</li> : null}
                {productRepositories.map((repository) => (
                  <li key={repository.id}>
                    <strong>{repository.name}</strong> — {repository.purpose} · branch <code>{repository.suggestedBranch}</code>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h4>First command</h4>
              <p className="muted small">After Cursor has read the copied handoff, run:</p>
              <code className="cursor-launch__command">/sdlc-next</code>
              <p className="muted small">
                Cursor should either identify the next permitted action or explain exactly what is blocked. It must not
                ask you to recreate decisions already included in the handoff.
              </p>
            </section>
          </div>

          <div className="cursor-launch__actions">
            <button type="button" className="primary-btn" onClick={() => void copy()}>
              <Copy size={15} /> {copied ? 'Copied Cursor instruction' : 'Copy Cursor instruction'}
            </button>
            <button
              type="button"
              className="secondary-btn"
              disabled={Boolean(startedAt)}
              onClick={() => onUpdate({
                implementationTool: 'cursor',
                implementationHandoffStartedAt: new Date().toISOString(),
                implementationHandoffStartedDigest: state.implementationReadinessDigest,
              })}
            >
              <ExternalLink size={15} /> {startedAt ? 'Opened in Cursor' : 'I opened this in Cursor'}
            </button>
          </div>
          {startedAt ? (
            <p className="muted small">
              Blink recorded this Cursor handoff at {new Date(startedAt).toLocaleString()}.
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
