import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { DeveloperToolsPage } from './DeveloperPopupApp'

export const DEVELOPER_INAPP_OPEN_EVENT = 'blink-developer-inapp-open' as const

type DeveloperInAppPanelProps = {
  open: boolean
  onClose: () => void
}

export function DeveloperInAppPanel({ open, onClose }: DeveloperInAppPanelProps) {
  useEffect(() => {
    if (!open) return
    document.body.classList.add('blink-dev-inapp-open')
    return () => document.body.classList.remove('blink-dev-inapp-open')
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="dev-inapp-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dev-inapp-shell"
        role="dialog"
        aria-modal="true"
        aria-label="Developer tools"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="dev-inapp-close" onClick={onClose} aria-label="Close developer tools">
          <X size={18} />
        </button>
        <DeveloperToolsPage surface="inapp" />
      </div>
    </div>,
    document.body,
  )
}
