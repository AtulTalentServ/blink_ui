import { Laptop } from 'lucide-react'
import type { WizardState } from '../wizard/types'

interface Props {
  state: WizardState
}

export function ImplementationReadinessScreen({ state }: Props) {
  return (
    <div className="screen cursor-work-screen">
      <div className="screen-header">
        <div>
          <p className="shape-kicker">Implementation</p>
          <h2>Work tickets in Cursor</h2>
          <p>
            The workspace package is the project handoff. Blink does not require a separate brief or a preselected
            ticket before you begin work.
          </p>
        </div>
        <Laptop size={28} aria-hidden className="cursor-work-screen__icon" />
      </div>

      <section className="card shape-section cursor-work-screen__steps">
        <h3>Continue in your workspace</h3>
        {state.gitWritten ? (
          <ol>
            <li>Download the prepared workspace package from the Workspace tab.</li>
            <li>Extract it and open the workspace in Cursor.</li>
            <li>Use the AI-SDLC commands to discover the next eligible ticket and load its canonical context.</li>
            <li>Work that ticket on its feature branch, then continue with the next eligible ticket in the same workspace.</li>
          </ol>
        ) : (
          <p className="muted">
            Prepare the workspace package first. Ticket selection and implementation happen later in Cursor through the
            AI-SDLC commands.
          </p>
        )}
      </section>
    </div>
  )
}
