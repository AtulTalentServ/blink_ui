import { canRunDesktopImplementBatch } from './detect'

type TauriCore = {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
}

type TauriDialog = {
  open: (options: {
    directory?: boolean
    multiple?: boolean
    title?: string
    defaultPath?: string
  }) => Promise<string | string[] | null>
}

function tauri(): { core: TauriCore; dialog?: TauriDialog } | null {
  if (!canRunDesktopImplementBatch()) return null
  const root = (window as unknown as { __TAURI__?: { core?: TauriCore; dialog?: TauriDialog } }).__TAURI__
  if (!root?.core?.invoke) return null
  return { core: root.core, dialog: root.dialog }
}

export type CursorCliStatus = { state: 'found' | 'missing'; version?: string | null; path?: string | null }
export type CursorCliAuthStatus = { authenticated: boolean; summary: string }
export type CursorCliModelGroup = 'cursor' | 'other'
export type CursorCliModelOption = { id: string; label: string; group: CursorCliModelGroup }

export async function fetchCursorCliStatus(): Promise<CursorCliStatus> {
  const api = tauri()
  if (!api) return { state: 'missing' }
  return api.core.invoke<CursorCliStatus>('cursor_cli_status')
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

/** Native folder picker (Tauri dialog plugin). */
export async function pickLocalWorkspaceFolder(currentPath?: string): Promise<string | null> {
  const api = tauri()
  if (!api?.dialog?.open) {
    throw new Error('Folder picker requires the Blink desktop app with dialog support.')
  }
  const selected = await api.dialog.open({
    directory: true,
    multiple: false,
    title: 'Choose local git workspace',
    defaultPath: currentPath?.trim() || undefined,
  })
  if (selected == null) return null
  return Array.isArray(selected) ? selected[0] ?? null : selected
}
