import { useEffect, useState } from 'react'
import { Code2, RotateCcw } from 'lucide-react'
import {
  DEVELOPER_CAPABILITIES,
  DEVELOPER_CAPABILITY_GROUPS,
  capabilitiesInGroup,
} from './catalog'
import { DeveloperModeProvider, useDeveloperMode } from './DeveloperModeContext'
import { loadDeveloperSession, subscribeDeveloperSession, type DeveloperSessionSnapshot } from './session'
import { S3WorkspacesPanel } from './S3WorkspacesPanel'
import { JiraEpicsPanel } from './JiraEpicsPanel'
import { CHAT_MODELS, CHAT_MODEL_STORAGE_KEY } from './chatModels'

function SessionBlock() {
  const { has } = useDeveloperMode()
  const [session, setSession] = useState<DeveloperSessionSnapshot | null>(loadDeveloperSession)

  useEffect(() => subscribeDeveloperSession(setSession), [])

  if (!has('showSessionInspector')) return null

  return (
    <section className="dev-popup-session">
      <h3>Live session</h3>
      <dl>
        <div>
          <dt>Step</dt>
          <dd>{session?.step ?? '—'}</dd>
        </div>
        <div>
          <dt>Project</dt>
          <dd>{session?.projectId ?? 'none'}</dd>
        </div>
        <div>
          <dt>Grooming</dt>
          <dd>{session?.groomingUnlocked ? 'ready' : 'locked'}</dd>
        </div>
      </dl>
    </section>
  )
}

function ChatModelPanel() {
  const [model, setModel] = useState(() => {
    try {
      return localStorage.getItem(CHAT_MODEL_STORAGE_KEY) || 'gpt-5.6-luna'
    } catch {
      return 'gpt-5.6-luna'
    }
  })

  const selectModel = (next: string) => {
    setModel(next)
    try {
      localStorage.setItem(CHAT_MODEL_STORAGE_KEY, next)
    } catch {
      /* The chat can still use this window's selected value when storage is unavailable. */
    }
  }

  return (
    <section className="dev-chat-model">
      <h2>AI model</h2>
      <p>Used by Blink chat and all AI operations. Credentials stay in the runtime environment.</p>
      <label>
        <span>Provider and model</span>
        <select value={model} onChange={(event) => selectModel(event.target.value)}>
          {CHAT_MODELS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label} · {option.hint}
            </option>
          ))}
        </select>
      </label>
    </section>
  )
}

function DeveloperToolsPage() {
  const { state, setEnabled, setCapability, resetCapabilities } = useDeveloperMode()

  useEffect(() => {
    document.title = 'Blink Developer'
  }, [])

  return (
    <div className="dev-popup">
      <header className="dev-popup-head">
        <Code2 size={18} strokeWidth={2.2} />
        <div>
          <h1>Developer mode</h1>
          <p>Separate from the Blink wizard. Close this window to hide the tools.</p>
        </div>
      </header>

      <label className={`dev-mode-master${state.enabled ? ' is-on' : ''}`}>
        <span>
          <strong>Enable developer mode</strong>
          <em>Turns on every control you leave checked below.</em>
        </span>
        <input
          type="checkbox"
          checked={state.enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <span className="dev-mode-switch" aria-hidden="true" />
      </label>

      <div className={`dev-mode-groups${state.enabled ? '' : ' is-dimmed'}`}>
        {DEVELOPER_CAPABILITY_GROUPS.map((group) => (
          <section key={group.id} className="dev-mode-group">
            <h2>{group.label}</h2>
            <p>{group.description}</p>
            <ul>
              {capabilitiesInGroup(group.id).map((id) => {
                const cap = DEVELOPER_CAPABILITIES[id]
                const checked = state.capabilities[id]
                return (
                  <li key={id}>
                    <label className={`dev-mode-flag${checked ? ' is-on' : ''}`}>
                      <span>
                        <strong>{cap.label}</strong>
                        <em>{cap.description}</em>
                      </span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => setCapability(id, event.target.checked)}
                      />
                      <span className="dev-mode-switch" aria-hidden="true" />
                    </label>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      <SessionBlock />
      <ChatModelPanel />

      <S3WorkspacesPanel />
      <JiraEpicsPanel />

      <footer className="dev-popup-foot">
        <button type="button" className="dev-mode-text-btn" onClick={resetCapabilities}>
          <RotateCcw size={13} />
          Reset controls
        </button>
        <span>Ctrl+Shift+D from Blink opens this window</span>
      </footer>
    </div>
  )
}

export function DeveloperPopupApp() {
  return (
    <DeveloperModeProvider>
      <DeveloperToolsPage />
    </DeveloperModeProvider>
  )
}
