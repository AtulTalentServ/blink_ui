import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'

export type DesktopToastItem = {
  id: string
  message: string
  kind: 'success' | 'error'
}

export function DesktopToastHost({
  toast,
  onDismiss,
}: {
  toast: DesktopToastItem | null
  onDismiss: () => void
}) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!toast) {
      setVisible(false)
      return
    }
    setVisible(true)
    const hide = window.setTimeout(() => setVisible(false), 3200)
    const remove = window.setTimeout(() => onDismiss(), 3600)
    return () => {
      window.clearTimeout(hide)
      window.clearTimeout(remove)
    }
  }, [toast, onDismiss])

  if (!toast) return null

  return (
    <div
      className={`desktop-toast desktop-toast--${toast.kind}${visible ? ' is-visible' : ''}`}
      role="status"
      aria-live="polite"
    >
      {toast.kind === 'success' ? (
        <CheckCircle2 size={16} aria-hidden />
      ) : (
        <XCircle size={16} aria-hidden />
      )}
      <span>{toast.message}</span>
    </div>
  )
}
