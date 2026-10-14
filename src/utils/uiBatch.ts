/** Coalesce rapid updates to at most one React commit per animation frame. */
export function rafCoalesce<T>(notify: (value: T) => void): {
  push: (value: T) => void
  flush: () => void
} {
  let pending: T | undefined
  let frame = 0

  const deliver = () => {
    if (pending === undefined) return
    const value = pending
    pending = undefined
    notify(value)
  }

  const flush = () => {
    if (frame) {
      cancelAnimationFrame(frame)
      frame = 0
    }
    deliver()
  }

  const push = (value: T) => {
    pending = value
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      deliver()
    })
  }

  return { push, flush }
}
