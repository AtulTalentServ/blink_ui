import { canRunDesktopImplementBatch, hasTauriInvoke } from './detect'
import { logDesktop } from './desktopLog'

type TauriCore = {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
}

function tauri(): { core: TauriCore } | null {
  if (!canRunDesktopImplementBatch()) return null
  const root = (window as unknown as { __TAURI__?: { core?: TauriCore } }).__TAURI__
  if (!root?.core?.invoke) return null
  return { core: root.core }
}

export type CursorCliStatus = { state: 'found' | 'missing'; version?: string | null; path?: string | null }
export type CursorCliAuthStatus = { authenticated: boolean; summary: string }
export type CursorCliModelGroup = 'cursor' | 'other'
export type CursorCliModelOption = { id: string; label: string; group: CursorCliModelGroup }

export async function fetchCursorCliStatus(): Promise<CursorCliStatus> {
  const api = tauri()
  if (!api) {
    logDesktop('cli-status', 'Tauri invoke unavailable (not in desktop shell?)')
    return { state: 'missing' }
  }
  try {
    return await api.core.invoke<CursorCliStatus>('cursor_cli_status')
  } catch (err) {
    logDesktop('cli-status', err)
    throw err
  }
}

export async function fetchCursorCliAuthStatus(): Promise<CursorCliAuthStatus> {
  const api = tauri()
  if (!api) return { authenticated: false, summary: 'Desktop shell only.' }
  return api.core.invoke<CursorCliAuthStatus>('cursor_cli_auth_status')
}

export type CursorCliInstallEvent = {
  type: 'log' | 'finished'
  message: string
  ok?: boolean
}

export async function installCursorCli(): Promise<string> {
  const api = tauri()
  if (!api) throw new Error('Install is only available in the Blink desktop app.')
  return api.core.invoke<string>('install_cursor_cli')
}

export async function fetchCursorCliInstallStatus(): Promise<{ installing: boolean }> {
  const api = tauri()
  if (!api) return { installing: false }
  return api.core.invoke<{ installing: boolean }>('cursor_cli_install_status')
}

export async function fetchCursorCliInstallLogs(): Promise<string[]> {
  const api = tauri()
  if (!api) return []
  return api.core.invoke<string[]>('cursor_cli_install_logs')
}

export async function subscribeCursorCliInstall(
  onEvent: (event: CursorCliInstallEvent) => void,
): Promise<() => void> {
  const root = (window as unknown as {
    __TAURI__?: {
      event?: { listen: (name: string, handler: (ev: { payload: string }) => void) => Promise<() => void> }
    }
  }).__TAURI__
  if (!root?.event?.listen) {
    return () => undefined
  }
  return root.event.listen('cursor-cli-install-event', (event) => {
    const raw = typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload)
    try {
      onEvent(JSON.parse(raw) as CursorCliInstallEvent)
    } catch {
      onEvent({ type: 'log', message: raw })
    }
  })
}

export async function loginCursorCli(): Promise<string> {
  const api = tauri()
  if (!api) throw new Error('Sign-in is only available in the Blink desktop app.')
  return api.core.invoke<string>('cursor_cli_login')
}

export async function fetchCursorCliModels(): Promise<CursorCliModelOption[]> {
  const api = tauri()
  if (!api) return [{ id: 'auto', label: 'Auto', group: 'cursor' }]
  try {
    const models = await api.core.invoke<CursorCliModelOption[]>('cursor_cli_list_models')
    return models.length ? models : [{ id: 'auto', label: 'Auto', group: 'cursor' }]
  } catch {
    return [{ id: 'auto', label: 'Auto', group: 'cursor' }]
  }
}

/** Native folder picker (Tauri 2 dialog plugin via invoke). */
export async function pickLocalWorkspaceFolder(currentPath?: string): Promise<string | null> {
  if (!hasTauriInvoke()) {
    throw new Error('Folder picker requires the Blink desktop app (restart the desktop shell after updating).')
  }
  const invoke = (window as unknown as { __TAURI__?: { core?: TauriCore } }).__TAURI__!.core!.invoke
  const options = {
    directory: true,
    multiple: false,
    title: 'Choose local git workspace',
    defaultPath: currentPath?.trim() || undefined,
  }
  try {
    const selected = await invoke<string | string[] | null>('plugin:dialog|open', { options })
    if (selected == null) return null
    return Array.isArray(selected) ? selected[0] ?? null : selected
  } catch (err) {
    logDesktop('folder-picker', err)
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      msg.includes('not allowed') || msg.includes('Forbidden')
        ? 'Folder picker blocked by desktop permissions. Restart Blink desktop (npm run dev in desktop/) after a git pull.'
        : `Folder picker failed: ${msg}`,
    )
  }
}
