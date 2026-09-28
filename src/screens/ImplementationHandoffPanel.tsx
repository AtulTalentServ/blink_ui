import { CheckCircle2, Copy, Download, FileText, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  buildImplementationHandoff,
  renderImplementationHandoff,
} from '../wizard/implementationHandoff'
import type { WizardState, WizardStep } from '../wizard/types'
import { CursorLaunchPanel } from './CursorLaunchPanel'
import { ExecutionPlanPanel } from './ExecutionPlanPanel'
import { ImplementationProgressPanel } from './ImplementationProgressPanel'
import { ImplementationResultReviewPanel } from './ImplementationResultReviewPanel'

interface Props {
  state: WizardState
  issueId: string
  ready: boolean
  onUpdate: (patch: Partial<WizardState>) => void
  onNavigate: (step: WizardStep) => void
}

function downloadHandoff(markdown: string, issueId: string) {
  const safeIssueId = issueId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'work-item'
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `cursor-handoff-${safeIssueId}.md`
  link.click()
  URL.revokeObjectURL(url)
}

export function ImplementationHandoffPanel({ state, issueId, ready, onUpdate, onNavigate }: Props) {
  const [copied, setCopied] = useState(false)
  const handoff = useMemo(
    () => (ready ? buildImplementationHandoff(state, issueId) : null),
    [issueId, ready, state],
  )
  const markdown = useMemo(() => (handoff ? renderImplementationHandoff(handoff) : ''), [handoff])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="card shape-section implementation-handoff">
      <div className="sdlc-panel__head">
        <FileText size={18} />
        <div>
          <h3>Cursor handoff</h3>
          <p className="muted">
            A story-specific brief assembled from your approved Blink decisions. It never includes integration
            credentials, and token-shaped values are redacted before display, copy, or download.
          </p>
        </div>
      </div>

      {!handoff ? (
        <p className="muted small">
          Confirm the current readiness context above to generate the handoff.
        </p>
      ) : (
        <>
          <div className="implementation-handoff__status">
            <CheckCircle2 size={17} aria-hidden />
            <span>Ready for {handoff.workItem.id}</span>
            <span className="implementation-handoff__version">v{handoff.version}</span>
            <span className="implementation-handoff__secrets">
              <ShieldCheck size={15} aria-hidden /> Secret filtering enabled
            </span>
          </div>
          <div className="implementation-handoff__actions">
            <button type="button" className="primary-btn" onClick={() => void copy()}>
              <Copy size={15} /> {copied ? 'Copied' : 'Copy handoff'}
            </button>
            <button type="button" className="secondary-btn" onClick={() => downloadHandoff(markdown, issueId)}>
              <Download size={15} /> Download .md
            </button>
          </div>
          <pre className="implementation-handoff__preview" aria-label="Cursor handoff preview">
            {markdown}
          </pre>
          <CursorLaunchPanel state={state} handoff={handoff} markdown={markdown} onUpdate={onUpdate} />
          <ExecutionPlanPanel state={state} handoff={handoff} onUpdate={onUpdate} onNavigate={onNavigate} />
          <ImplementationProgressPanel state={state} handoff={handoff} onUpdate={onUpdate} />
          <ImplementationResultReviewPanel state={state} handoff={handoff} onUpdate={onUpdate} />
        </>
      )}
    </section>
  )
}
