/** Run work when the browser is idle so clicks/scroll stay responsive. */
export function scheduleIdleWork(fn: () => void, timeoutMs = 2500): () => void {
  let cancelled = false
  const run = () => {
    if (!cancelled) fn()
  }
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(run, { timeout: timeoutMs })
    return () => {
      cancelled = true
      cancelIdleCallback(id)
    }
  }
  const timer = window.setTimeout(run, 16)
  return () => {
    cancelled = true
    window.clearTimeout(timer)
  }
}
