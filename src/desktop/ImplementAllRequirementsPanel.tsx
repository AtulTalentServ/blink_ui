import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { DesktopToastHost, type DesktopToastItem } from './DesktopToast'
import {
  CheckCircle2,
  FolderOpen,
  Loader2,
  Play,
  RefreshCw,
  Terminal,
  XCircle,
} from 'lucide-react'
import { canRunDesktopImplementBatch } from './detect'
import { CursorAgentConversationPanel } from './CursorAgentConversationPanel'
import { ImplementRunStatusPanel } from './ImplementRunStatusPanel'
import {
  loadCursorConversation,
  mergePersistedIntoRunState,
  saveCursorConversation,
} from './cursorConversationPersist'
import { startDesktopImplementBatch } from './implementRun'
import {
  addUserTurn,
  emptyImplementRunState,
  toggleThinkingCollapsed,
  type ImplementRunState,
} from './implementRunTypes'
import type { RequirementsBatchContext } from '../wizard/implementRunMode'
import { DocMarkdown } from '../components/DocMarkdown'
import { excerptRequirements } from '../wizard/implementRunMode'
import { loadDesktopWorkspacePath, saveDesktopWorkspacePath } from './workspacePath'
import {
  fetchCursorCliAuthStatus,
  fetchCursorCliInstallLogs,
  fetchCursorCliInstallStatus,
  fetchCursorCliModels,
  fetchCursorCliStatus,
  installCursorCli,
  loginCursorCli,
  pickLocalWorkspaceFolder,
  subscribeCursorCliInstall,
  type CursorCliAuthStatus,
  type CursorCliModelOption,
  type CursorCliStatus,
} from './tauriDesktop'

type Props = {
  batchRequirements: RequirementsBatchContext | null
  readyForAgent: boolean
  workspaceReady: boolean
}

function SetupRow({
  title,
  status,
  children,
}: {
  title: string
  status: 'ok' | 'warn' | 'pending' | 'busy' | 'neutral'
  children: ReactNode
}) {
  return (
    <div className={`implement-all-setup-row is-${status}`}>
      <div className="implement-all-setup-row__head">
        {status === 'ok' ? (
          <CheckCircle2 size={18} aria-hidden />
        ) : status === 'neutral' ? (
          <Terminal size={18} aria-hidden />
        ) : status === 'busy' ? (
          <Loader2 size={18} className="spin" aria-hidden />
        ) : status === 'warn' ? (
          <XCircle size={18} aria-hidden />
        ) : (
          <Terminal size={18} aria-hidden />
        )}
        <strong>{title}</strong>
      </div>
      <div className="implement-all-setup-row__body">{children}</div>
    </div>
  )
}

export function ImplementAllRequirementsPanel({
  batchRequirements,
  readyForAgent,
  workspaceReady,
}: Props) {
  const desktop = canRunDesktopImplementBatch()
  const [workspacePath, setWorkspacePath] = useState(() => loadDesktopWorkspacePath())
  const [cursorCli, setCursorCli] = useState<CursorCliStatus | null>(null)
  const [cursorAuth, setCursorAuth] = useState<CursorCliAuthStatus | null>(null)
  const [setupBusy, setSetupBusy] = useState<string | null>(null)
  const [cursorInstallLog, setCursorInstallLog] = useState<string[]>([])
  const [cursorInstalling, setCursorInstalling] = useState(false)
  const [desktopRun, setDesktopRun] = useState<ImplementRunState>(() => emptyImplementRunState())
  const [runBusy, setRunBusy] = useState(false)
  const [cursorModel, setCursorModel] = useState('auto')
  const [cursorModels, setCursorModels] = useState<CursorCliModelOption[]>([
    { id: 'auto', label: 'Auto', group: 'cursor' },
  ])
  const [cursorModelsLoading, setCursorModelsLoading] = useState(false)
  const [continueSession, setContinueSession] = useState(true)
  const [chatDraft, setChatDraft] = useState('')
  const [toast, setToast] = useState<DesktopToastItem | null>(null)

  const pushToast = useCallback((message: string, kind: DesktopToastItem['kind']) => {
    setToast({ id: `${Date.now()}-${Math.random()}`, message, kind })
  }, [])

  const refreshSetup = useCallback(async () => {
    if (!desktop) return
    const [cli, auth] = await Promise.all([fetchCursorCliStatus(), fetchCursorCliAuthStatus()])
    setCursorCli(cli)
    setCursorAuth(auth)
    const installed = cli.state === 'found' || Boolean(cli.path?.trim())
    if (installed) {
      setCursorModelsLoading(true)
      try {
        const models = await fetchCursorCliModels()
        setCursorModels(models)
      } finally {
        setCursorModelsLoading(false)
      }
    }
  }, [desktop])

  useEffect(() => {
    void refreshSetup()
    if (!desktop) return
    void fetchCursorCliInstallLogs().then(setCursorInstallLog)
    void fetchCursorCliInstallStatus().then((s) => setCursorInstalling(s.installing))
    let unlisten: (() => void) | undefined
    void subscribeCursorCliInstall((event) => {
      setCursorInstallLog((prev) => [...prev, event.message].slice(-500))
      if (event.type === 'finished') {
        setCursorInstalling(false)
        void refreshSetup()
        if (event.ok === false) {
          pushToast(event.message, 'error')
        } else if (event.ok) {
          pushToast(event.message, 'success')
        }
      }
    }).then((fn) => {
      unlisten = fn
    })
    return () => unlisten?.()
  }, [desktop, refreshSetup, pushToast])

  useEffect(() => {
    if (!desktop || !cursorInstalling) return
    const timer = window.setInterval(() => {
      void fetchCursorCliInstallLogs().then(setCursorInstallLog)
      void fetchCursorCliInstallStatus().then((s) => setCursorInstalling(s.installing))
      void refreshSetup()
    }, 2500)
    return () => window.clearInterval(timer)
  }, [desktop, cursorInstalling, refreshSetup])

  useEffect(() => {
    const ws = workspacePath.trim()
    if (!ws) return
    const persisted = loadCursorConversation(ws)
    if (!persisted) return
    setCursorModel(persisted.model || 'auto')
    setContinueSession(persisted.continueSession ?? true)
    setDesktopRun((prev) => mergePersistedIntoRunState(prev, persisted))
  }, [workspacePath])

  useEffect(() => {
    const ws = workspacePath.trim()
    if (!ws) return
    const timer = window.setTimeout(() => {
      saveCursorConversation(ws, desktopRun, { model: cursorModel, continueSession })
    }, 400)
    return () => window.clearTimeout(timer)
  }, [workspacePath, desktopRun, cursorModel, continueSession])

  const cursorInstalled = cursorCli?.state === 'found' || Boolean(cursorCli?.path?.trim())
  const cursorSignedIn = Boolean(cursorAuth?.authenticated)
  const canRun =
    desktop
    && Boolean(batchRequirements?.text)
    && Boolean(workspacePath.trim())
    && cursorInstalled
    && cursorSignedIn
    && readyForAgent
    && workspaceReady
    && !desktopRun.running

  const pickFolder = async () => {
    try {
      setSetupBusy('folder')
      const picked = await pickLocalWorkspaceFolder(workspacePath)
      if (picked) {
        setWorkspacePath(picked)
        saveDesktopWorkspacePath(picked)
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not open folder picker.', 'error')
    } finally {
      setSetupBusy(null)
    }
  }

  const runInstallCursor = async () => {
    try {
      setSetupBusy('cursor-install')
      setCursorInstalling(true)
      setCursorInstallLog([])
      const msg = await installCursorCli()
      pushToast(msg, 'success')
    } catch (err) {
      setCursorInstalling(false)
      pushToast(err instanceof Error ? err.message : 'Cursor CLI install failed.', 'error')
    } finally {
      setSetupBusy(null)
    }
  }

  const runCursorLogin = async () => {
    try {
      setSetupBusy('cursor-login')
      const msg = await loginCursorCli()
      pushToast(msg, 'success')
      window.setTimeout(() => void refreshSetup(), 4000)
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not start Cursor sign-in.', 'error')
    } finally {
      setSetupBusy(null)
    }
  }

  const runAgent = async (mode: 'batch' | 'chat', chatMessage?: string) => {
    const ws = workspacePath.trim()
    if (!ws) return
    setRunBusy(true)
    const persisted = loadCursorConversation(ws)
    let next = mergePersistedIntoRunState(
      { ...emptyImplementRunState(), running: true, finished: undefined },
      persisted,
    )
    if (mode === 'chat' && chatMessage) {
      next = addUserTurn(next, chatMessage)
    } else if (mode === 'batch') {
      next = addUserTurn(next, 'Implement all requirements in this workspace (batch run).')
    }
    setDesktopRun(next)

    try {
      await startDesktopImplementBatch(
        {
          workspace: ws,
          runMode: mode,
          requirements: mode === 'batch' ? batchRequirements?.text ?? '' : '',
          chatMessage: mode === 'chat' ? chatMessage ?? '' : '',
          useWorktree: true,
          provider: 'cursor-cli',
          model: cursorModel,
          continueSession,
          initialState: next,
        },
        setDesktopRun,
      )
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not start implement run.', 'error')
      setDesktopRun((prev) => ({ ...prev, running: false }))
    } finally {
      setRunBusy(false)
    }
  }

  const startRun = async () => {
    if (!batchRequirements) return
    await runAgent('batch')
  }

  const sendChat = async () => {
    const msg = chatDraft.trim()
    if (!msg || !cursorInstalled || !cursorSignedIn) return
    setChatDraft('')
    await runAgent('chat', msg)
  }

  const stopRun = async () => {
    try {
      const tauri = (window as unknown as { __TAURI__?: { core?: { invoke?: (cmd: string) => Promise<unknown> } } })
        .__TAURI__
      await tauri?.core?.invoke?.('stop_implement_batch')
    } catch {
      /* ignore */
    }
    setDesktopRun((prev) => ({ ...prev, running: false }))
  }

  if (!desktop) {
    return (
      <div className="implement-all-panel">
        <p className="status-banner info">
          Implement-all runs on your machine through the Blink desktop app (Cursor CLI). Open desktop to pick a folder,
          set up the agent CLI, and run with live status.
        </p>
        {batchRequirements ? (
          <DocMarkdown
            className="implement-batch-requirements-preview"
            text={excerptRequirements(batchRequirements.text, 1200)}
          />
        ) : (
          <p className="muted small">Add grooming or scope requirements first.</p>
        )}
      </div>
    )
  }

  return (
    <div className="implement-all-panel">
      <header className="implement-all-panel__head">
        <h3>Implement all requirements</h3>
        <p className="muted small">
          One batch over your current requirements text — not Jira tickets. Cursor CLI applies code changes directly in
          your workspace.
        </p>
      </header>

      <section className="implement-all-section">
        <h4>Requirements</h4>
        {batchRequirements ? (
          <>
            <p className="muted small">
              {batchRequirements.sourceLabel} · {batchRequirements.text.length.toLocaleString()} characters
            </p>
            <DocMarkdown
              className="implement-batch-requirements-preview"
              text={excerptRequirements(batchRequirements.text)}
            />
          </>
        ) : (
          <p className="status-banner info">Finish grooming or product scope so Blink has requirements to implement.</p>
        )}
      </section>

      <section className="implement-all-section">
        <div className="implement-all-section__toolbar">
          <h4>Setup</h4>
          <button type="button" className="ghost-btn mini-btn" onClick={() => void refreshSetup()} disabled={!!setupBusy}>
            <RefreshCw size={14} aria-hidden />
            Refresh status
          </button>
        </div>

        <SetupRow
          title="Local workspace folder"
          status={workspacePath.trim() ? 'neutral' : 'warn'}
        >
          <p className="muted small">Git repo where Cursor will apply changes (uses native folder picker).</p>
          <div className="implement-all-folder-row">
            <code className="implement-all-folder-path">{workspacePath.trim() || 'No folder selected'}</code>
            <button type="button" className="secondary-btn" disabled={desktopRun.running || !!setupBusy} onClick={() => void pickFolder()}>
              <FolderOpen size={15} aria-hidden />
              Choose folder…
            </button>
          </div>
        </SetupRow>

        {!cursorInstalled ? (
          <SetupRow
            title="Cursor CLI"
            status={cursorInstalling || setupBusy === 'cursor-install' ? 'busy' : 'warn'}
          >
            <p className="muted small">
              {cursorInstalling
                ? 'Installing Cursor CLI — progress appears in the log below.'
                : 'Install the Cursor agent CLI (Windows PowerShell installer).'}
            </p>
            <button
              type="button"
              className="secondary-btn"
              disabled={!!setupBusy || cursorInstalling}
              onClick={() => void runInstallCursor()}
            >
              {cursorInstalling || setupBusy === 'cursor-install' ? (
                <Loader2 className="spin" size={15} />
              ) : (
                <Terminal size={15} />
              )}
              {cursorInstalling ? 'Installing…' : 'Install Cursor CLI'}
            </button>
            {(cursorInstalling || cursorInstallLog.length > 0) && (
              <details className="desktop-setup-log" open={cursorInstalling}>
                <summary>Cursor CLI install log{cursorInstalling ? ' (running…)' : ''}</summary>
                <pre aria-live="polite">
                  {cursorInstallLog.length ? cursorInstallLog.join('\n') : 'Waiting for installer output…'}
                </pre>
              </details>
            )}
          </SetupRow>
        ) : null}

        {cursorInstalled && !cursorSignedIn ? (
          <SetupRow title="Cursor sign-in" status={setupBusy === 'cursor-login' ? 'busy' : 'warn'}>
            <p className="muted small">Sign in with browser (agent login).</p>
            <button type="button" className="secondary-btn" disabled={!!setupBusy} onClick={() => void runCursorLogin()}>
              {setupBusy === 'cursor-login' ? <Loader2 className="spin" size={15} /> : null}
              Sign in with browser
            </button>
          </SetupRow>
        ) : null}
      </section>

      {workspacePath.trim() && cursorInstalled ? (
        <CursorAgentConversationPanel
          state={desktopRun}
          models={cursorModels}
          modelsLoading={cursorModelsLoading}
          model={cursorModel}
          continueSession={continueSession}
          chatDraft={chatDraft}
          chatDisabled={!cursorSignedIn || desktopRun.running || runBusy}
          onModelChange={setCursorModel}
          onContinueSessionChange={setContinueSession}
          onChatDraftChange={setChatDraft}
          onSendChat={() => void sendChat()}
          onStop={() => void stopRun()}
          onToggleThinking={(id) => setDesktopRun((s) => toggleThinkingCollapsed(s, id))}
        />
      ) : null}

      <div className="ship-actions implement-all-actions">
        {desktopRun.running ? (
          <button type="button" className="secondary-btn" onClick={() => void stopRun()}>
            Stop run
          </button>
        ) : (
          <button type="button" className="primary-btn" disabled={!canRun || runBusy} onClick={() => void startRun()}>
            {runBusy ? <Loader2 className="spin" size={16} aria-hidden /> : <Play size={16} aria-hidden />}
            <span>Start implement-all</span>
          </button>
        )}
      </div>

      {(desktopRun.running || desktopRun.steps.length > 0) && <ImplementRunStatusPanel state={desktopRun} />}

      <DesktopToastHost toast={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
