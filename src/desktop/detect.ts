/** True when Blink runs inside the Tauri desktop shell (see desktop status_strip.js). */
export function isBlinkDesktopShell(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.classList.contains('blink-desktop')
}

export function hasTauriInvoke(): boolean {
  const tauri = (window as unknown as { __TAURI__?: { core?: { invoke?: unknown } } }).__TAURI__
  return typeof tauri?.core?.invoke === 'function'
}

export function canRunDesktopImplementBatch(): boolean {
  return isBlinkDesktopShell() && hasTauriInvoke()
}
