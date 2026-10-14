/** Developer option: route Blink API calls to local Go or hosted Render. */

import { isBlinkDesktopShell } from '../desktop/detect'

export const API_TARGET_STORAGE_KEY = 'blink.apiTarget'
export const API_TARGET_HEADER = 'x-blink-api-target'

export const DEPLOYED_API_BASE = 'https://blink-backend-af7x.onrender.com/api'

export type ApiTarget = 'local' | 'deployed'

export const API_TARGET_OPTIONS: { id: ApiTarget; label: string; hint: string }[] = [
  { id: 'local', label: 'Local backend', hint: 'Go API on port 8090' },
  { id: 'deployed', label: 'Deployed backend', hint: 'Render (hosted)' },
]

function readStoredTarget(): ApiTarget | null {
  try {
    const raw = localStorage.getItem(API_TARGET_STORAGE_KEY)
    if (raw === 'local' || raw === 'deployed') return raw
  } catch {
    /* ignore */
  }
  return null
}

/** Default when developer has not chosen: match Vite env (local dev → /api). */
function envDefaultTarget(): ApiTarget {
  const envBase = (import.meta.env.VITE_API_URL ?? DEPLOYED_API_BASE).replace(/\/$/, '')
  if (envBase.startsWith('/') || /localhost|127\.0\.0\.1/.test(envBase)) {
    return 'local'
  }
  return 'deployed'
}

export function getApiTarget(): ApiTarget {
  return readStoredTarget() ?? envDefaultTarget()
}

export function setApiTarget(target: ApiTarget): void {
  localStorage.setItem(API_TARGET_STORAGE_KEY, target)
  window.dispatchEvent(new CustomEvent('blink-api-target-changed', { detail: { target } }))
}

function normalizeApiSuffix(base: string): string {
  const trimmed = base.replace(/\/$/, '')
  if (trimmed.endsWith('/api')) return trimmed
  return `${trimmed}/api`
}

/** Local Go server; use Vite `/api` proxy only during `npm run dev`. */
function localApiBase(): string {
  if (import.meta.env.DEV) {
    const envBase = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '')
    if (envBase.startsWith('/')) {
      return normalizeApiSuffix(envBase.startsWith('/') ? envBase : `/${envBase}`)
    }
    if (/^https?:\/\//.test(envBase)) {
      return normalizeApiSuffix(envBase)
    }
  }
  return 'http://127.0.0.1:8090/api'
}

/** Desktop dev (5174) uses same-origin `/api` so Vite can proxy without Render CORS for 5174. */
export function usesDesktopDevApiProxy(): boolean {
  return isBlinkDesktopShell() && import.meta.env.DEV
}

/** Base URL including `/api` suffix, no trailing slash. */
export function resolveApiBase(): string {
  const target = getApiTarget()
  if (usesDesktopDevApiProxy()) {
    return normalizeApiSuffix('/api')
  }
  if (target === 'deployed') {
    return DEPLOYED_API_BASE
  }
  return localApiBase()
}

export function isLocalApiTarget(): boolean {
  return getApiTarget() === 'local'
}

export function describeApiTarget(target: ApiTarget = getApiTarget()): string {
  if (usesDesktopDevApiProxy()) {
    return target === 'local' ? 'Local (via desktop proxy → :8090)' : 'Deployed (via desktop proxy → Render)'
  }
  const base = target === 'local' ? localApiBase() : DEPLOYED_API_BASE
  return target === 'local' ? `Local (${base})` : 'Deployed (Render)'
}

/** Vite proxy 503 when Go is not listening on 8090 while UI still uses `/api`. */
export function isLocalBackendUnavailableMessage(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes('8090') && (lower.includes('not running') || lower.includes('local blink api'))
}
