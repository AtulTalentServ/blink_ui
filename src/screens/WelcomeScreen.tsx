import { useState } from 'react'
import {
  ClipboardList,
  FileText,
  FolderPlus,
  Link2,
  Play,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Users,
  Wrench,
} from 'lucide-react'
import { AppHeader } from '../components/AppHeader'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { SessionControls } from '../components/SessionControls'
import type { WizardState, WorkMode } from '../wizard/types'

interface Props {
  state: WizardState
  resume: { projectName: string; stepLabel: string } | null
  onContinue: (mode: WorkMode) => void
  onResume: () => void
}

const FLOW = [
  { icon: Users, label: 'Stakeholders', desc: 'Who is in the loop' },
  { icon: Link2, label: 'Integrations', desc: 'Jira, GitHub, and tools' },
  { icon: FileText, label: 'Requirements', desc: 'What you are building' },
  { icon: ClipboardList, label: 'Work plan', desc: 'Work the team can run' },
  { icon: Rocket, label: 'Ship', desc: 'Repos and handoff' },
]

const START_CARDS: { id: WorkMode; label: string; icon: typeof FolderPlus }[] = [
  { id: 'new', label: 'New project', icon: FolderPlus },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench },
  { id: 'modernization', label: 'Modernization', icon: RefreshCw },
]

const CONFIRM: Record<WorkMode, { title: string; copy: string; confirmLabel: string }> = {
  new: {
    title: 'New project?',
    copy: 'This leaves the current draft and starts a new project.',
    confirmLabel: 'New project',
  },
  maintenance: {
    title: 'Maintenance?',
    copy: 'This leaves the current draft and starts a maintenance project.',
    confirmLabel: 'Maintenance',
  },
  modernization: {
    title: 'Modernization?',
    copy: 'This leaves the current draft and starts a modernization project.',
    confirmLabel: 'Modernization',
  },
}

export function WelcomeScreen({ resume, onContinue, onResume }: Props) {
  const [pendingMode, setPendingMode] = useState<WorkMode | null>(null)

  function choose(mode: WorkMode) {
    if (resume) {
      setPendingMode(mode)
      return
    }
    onContinue(mode)
  }

  return (
    <div className="welcome-page">
      <AppHeader end={<SessionControls />} />

      <div className="welcome-body">
        <div className="welcome-headline">
          <h1>
            Welcome to <span className="gradient-text">Blink</span>
          </h1>
        </div>

        <div className="project-cards">
          {START_CARDS.map(({ id, label, icon: Icon }) => (
            <button type="button" className="project-card" key={id} onClick={() => choose(id)}>
              <div className="project-card-icon">
                <Icon size={28} strokeWidth={1.75} />
              </div>
              <h3>{label}</h3>
            </button>
          ))}
          <button
            type="button"
            className="project-card"
            disabled={!resume}
            onClick={onResume}
          >
            <div className="project-card-icon">
              <Play size={28} strokeWidth={1.75} />
            </div>
            <h3>Draft continue</h3>
          </button>
        </div>

        <ol className="welcome-flow" aria-label="How Blink works">
          {FLOW.map(({ icon: Icon, label, desc }) => (
            <li className="welcome-flow-step" key={label}>
              <span className="welcome-flow-icon">
                <Icon size={18} />
              </span>
              <div>
                <strong>{label}</strong>
                <span>{desc}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <footer className="welcome-footer">
        <span className="footer-trust">
          <ShieldCheck size={14} /> Secure • Scalable • Smart
        </span>
        <span className="footer-copy">© {new Date().getFullYear()} TalentServ. All rights reserved.</span>
      </footer>

      {pendingMode && (
        <ConfirmDialog
          title={CONFIRM[pendingMode].title}
          copy={CONFIRM[pendingMode].copy}
          confirmLabel={CONFIRM[pendingMode].confirmLabel}
          titleId="home-start-title"
          copyId="home-start-copy"
          onCancel={() => setPendingMode(null)}
          onConfirm={() => {
            const mode = pendingMode
            setPendingMode(null)
            onContinue(mode)
          }}
        />
      )}
    </div>
  )
}
