import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  AlertCircle,
  CircleCheck,
  Code2,
  Menu,
  PanelLeft,
  PanelLeftClose,
  X,
} from 'lucide-react'
import { useDeveloperMode } from '../developer/DeveloperModeContext'
import { openDeveloperPopup } from '../developer/window'
import { TalentServLogo } from './TalentServLogo'
import { BlinkLogo } from './BlinkLogo'
import {
  WIZARD_STEPS,
  canNavigateToStep,
  phaseProgressLabel,
  stepAttention,
} from '../wizard/steps'
import type { WizardState, WizardStep } from '../wizard/types'

const SIDEBAR_OPEN_KEY = 'blink.sidebar.open'
const SIDEBAR_WIDTH_KEY = 'blink.sidebar.width'

const SIDEBAR_MIN_W = 200
const SIDEBAR_MAX_W = 420
const SIDEBAR_DEFAULT_W = 272
const SIDEBAR_COLLAPSED_W = 56

interface Props {
  currentStep: WizardStep
  completedThrough: number
  generationComplete: boolean
  groomingUnlocked: boolean
  unrestrictedNav?: boolean
  state: WizardState
  onNavigate: (step: WizardStep) => void
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return raw === '1'
  } catch {
    return fallback
  }
}

function readNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = Number(localStorage.getItem(key))
    if (Number.isFinite(raw)) return Math.min(max, Math.max(min, raw))
  } catch {
    /* ignore */
  }
  return fallback
}

export function WizardSidebar({
  currentStep,
  completedThrough,
  generationComplete,
  groomingUnlocked,
  unrestrictedNav = false,
  state,
  onNavigate,
}: Props) {
  const { state: developerState } = useDeveloperMode()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => readBool(SIDEBAR_OPEN_KEY, true))
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readNumber(SIDEBAR_WIDTH_KEY, SIDEBAR_DEFAULT_W, SIDEBAR_MIN_W, SIDEBAR_MAX_W),
  )
  const sidebarDragRef = useRef<{ startX: number; startW: number } | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_OPEN_KEY, sidebarOpen ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [sidebarOpen])

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth))
    } catch {
      /* ignore */
    }
  }, [sidebarWidth])

  const progressLabel = useMemo(() => phaseProgressLabel(currentStep), [currentStep])
  const currentLabel = WIZARD_STEPS.find((s) => s.id === currentStep)?.label

  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  useEffect(() => {
    document.body.classList.toggle('is-mobile-drawer-open', mobileOpen)
    return () => document.body.classList.remove('is-mobile-drawer-open')
  }, [mobileOpen])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)')
    const onChange = () => {
      if (!media.matches) setMobileOpen(false)
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  function navigate(step: WizardStep) {
    onNavigate(step)
    setMobileOpen(false)
  }

  function onSidebarResizeDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!sidebarOpen) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    sidebarDragRef.current = { startX: event.clientX, startW: sidebarWidth }
    document.body.classList.add('is-resizing-sidebar')
  }

  function onSidebarResizeMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!sidebarDragRef.current) return
    const delta = event.clientX - sidebarDragRef.current.startX
    setSidebarWidth(
      Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, sidebarDragRef.current.startW + delta)),
    )
  }

  function onSidebarResizeUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!sidebarDragRef.current) return
    sidebarDragRef.current = null
    document.body.classList.remove('is-resizing-sidebar')
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
  }

  const navSteps = WIZARD_STEPS

  const navBody = (
    <nav className="nav-card" aria-label="SDLC steps">
      <ul className="nav-list">
        {navSteps.map((step) => {
          const attention = stepAttention(
            step.id,
            currentStep,
            completedThrough,
            generationComplete,
            state,
          )
          const clickable = canNavigateToStep(
            step.id,
            currentStep,
            completedThrough,
            groomingUnlocked,
            unrestrictedNav,
            Boolean(state.shapeAcknowledged),
            state.canonicalAllowedSteps,
          )
          const Icon =
            attention === 'done'
              ? CircleCheck
              : attention === 'attention'
                ? AlertCircle
                : step.icon
          return (
            <li
              key={step.id}
              className={`nav-item ${attention} ${clickable ? 'clickable' : ''}${step.id === 'welcome' ? ' is-home' : ''}`}
              onClick={() => clickable && navigate(step.id)}
              onKeyDown={(e) => e.key === 'Enter' && clickable && navigate(step.id)}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
            >
              <Icon size={15} strokeWidth={attention === 'done' ? 2.4 : 2} />
              <span className="nav-label">{step.label}</span>
            </li>
          )
        })}
      </ul>
    </nav>
  )

  const width = sidebarOpen ? sidebarWidth : SIDEBAR_COLLAPSED_W

  return (
    <>
    <div className="sidebar-mobile-bar">
      <div className="sidebar-mobile-progress">
        <strong>{progressLabel}</strong>
        <span>{currentLabel}</span>
      </div>
      <button
        type="button"
        className="ghost-btn sidebar-mobile-toggle"
        aria-expanded={mobileOpen}
        aria-controls="wizard-sidebar"
        aria-label={mobileOpen ? 'Close steps' : 'Open steps'}
        onClick={() => setMobileOpen((v) => !v)}
      >
        {mobileOpen ? <X size={18} /> : <Menu size={18} />}
      </button>
    </div>
    {mobileOpen ? (
      <button
        type="button"
        className="sidebar-backdrop"
        aria-label="Close steps"
        onClick={() => setMobileOpen(false)}
      />
    ) : null}
    <aside
      id="wizard-sidebar"
      className={`sidebar${sidebarOpen ? '' : ' is-collapsed'}${mobileOpen ? ' is-mobile-open' : ''}`}
      style={{
        width,
        ['--sidebar-width' as string]: `${width}px`,
      }}
      aria-label="SDLC steps"
    >
      <div className="sidebar-chrome">
        <div className="brand sidebar-brand">
          <div className="sidebar-brand-row">
            <TalentServLogo size="sm" />
            <span className="brand-divider" />
            <BlinkLogo size="sm" />
          </div>
        </div>
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? 'Minimize sidebar' : 'Expand sidebar'}
          aria-label={sidebarOpen ? 'Minimize sidebar' : 'Expand sidebar'}
          aria-pressed={!sidebarOpen}
        >
          {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
        </button>
      </div>

      <div
        className={`sidebar-nav-wrap${mobileOpen ? ' is-open' : ''}${developerState.enabled ? ' has-dev-chip' : ''}`}
      >
        {navBody}
      </div>

      {!sidebarOpen ? (
        <nav className="sidebar-rail" aria-label="SDLC step icons">
          {navSteps.map((step) => {
            const attention = stepAttention(
              step.id,
              currentStep,
              completedThrough,
              generationComplete,
              state,
            )
            const clickable = canNavigateToStep(
              step.id,
              currentStep,
              completedThrough,
              groomingUnlocked,
              unrestrictedNav,
              Boolean(state.shapeAcknowledged),
              state.canonicalAllowedSteps,
            )
            const Icon =
              attention === 'done'
                ? CircleCheck
                : attention === 'attention'
                  ? AlertCircle
                  : step.icon
            return (
              <button
                key={step.id}
                type="button"
                className={`sidebar-rail-btn ${attention}${clickable ? ' clickable' : ''}`}
                title={step.label}
                aria-label={step.label}
                aria-current={attention === 'active' ? 'step' : undefined}
                disabled={!clickable}
                onClick={() => clickable && navigate(step.id)}
              >
                <Icon size={16} strokeWidth={attention === 'done' ? 2.4 : 2} />
              </button>
            )
          })}
        </nav>
      ) : null}

      {state.canonicalBlockers?.length ? (
        <div className="sidebar-blockers" aria-label="Canonical blockers">
          {state.canonicalBlockers.slice(0, 2).map((b) => (
            <p key={b.code || b.message} className="quiet-hint" title={b.message}>
              {b.code ? <code>{b.code}</code> : null}
              {b.code ? ' · ' : null}
              {b.message}
            </p>
          ))}
          {state.canonicalBlockers.length > 2 ? (
            <p className="quiet-hint">+{state.canonicalBlockers.length - 2} more canonical blocker(s)</p>
          ) : null}
        </div>
      ) : null}

      {developerState.enabled ? (
        <div className="account-float is-collapsed">
          <div className="account-float-collapsed">
            <button
              type="button"
              className={sidebarOpen ? 'account-float-dev is-on' : 'account-dev-btn is-on'}
              onClick={() => openDeveloperPopup()}
              title="Developer tools (Ctrl+Shift+D)"
              aria-label="Open developer tools"
            >
              <Code2 size={14} strokeWidth={2.25} />
              {sidebarOpen ? <span>Developer tools</span> : null}
            </button>
          </div>
        </div>
      ) : null}

      <div
        className="sidebar-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title={sidebarOpen ? 'Drag to resize' : 'Expand sidebar'}
        onDoubleClick={() => setSidebarOpen((v) => !v)}
        onPointerDown={onSidebarResizeDown}
        onPointerMove={onSidebarResizeMove}
        onPointerUp={onSidebarResizeUp}
        onPointerCancel={onSidebarResizeUp}
      />
    </aside>
    </>
  )
}

export { STEP_ORDER } from '../wizard/steps'
