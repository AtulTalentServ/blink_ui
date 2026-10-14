export const DESKTOP_WORKSPACE_PATH_KEY = 'blink.desktopWorkspacePath'

export function loadDesktopWorkspacePath(): string {
  try {
    return localStorage.getItem(DESKTOP_WORKSPACE_PATH_KEY)?.trim() || ''
  } catch {
    return ''
  }
}

export function saveDesktopWorkspacePath(path: string): void {
  localStorage.setItem(DESKTOP_WORKSPACE_PATH_KEY, path.trim())
}
