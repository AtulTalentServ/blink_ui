import { useEffect, useState } from 'react'
import { DeveloperInAppPanel, DEVELOPER_INAPP_OPEN_EVENT } from './DeveloperInAppPanel'
import { openDeveloperTools } from './window'
import './developer.css'

function isDeveloperShortcut(event: KeyboardEvent): boolean {
  if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) {
    return false
  }
  return event.code === 'KeyD' || event.key.toLowerCase() === 'd'
}

/** Ctrl+Shift+D opens developer tools (popup or in-app fallback). */
export function DeveloperWindowHost() {
  const [inAppOpen, setInAppOpen] = useState(false)

  useEffect(() => {
    const onInAppOpen = () => setInAppOpen(true)
    window.addEventListener(DEVELOPER_INAPP_OPEN_EVENT, onInAppOpen)
    return () => window.removeEventListener(DEVELOPER_INAPP_OPEN_EVENT, onInAppOpen)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isDeveloperShortcut(event)) return
      event.preventDefault()
      event.stopPropagation()
      if (inAppOpen) {
        setInAppOpen(false)
        return
      }
      openDeveloperTools()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [inAppOpen])

  return <DeveloperInAppPanel open={inAppOpen} onClose={() => setInAppOpen(false)} />
}
