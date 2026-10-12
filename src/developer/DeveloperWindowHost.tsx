import { useEffect } from 'react'
import { openDeveloperPopup } from './window'
import './developer.css'

/** Keeps Ctrl+Shift+D working; profile widget only shows tools after developer mode is on. */
export function DeveloperWindowHost() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        event.stopPropagation()
        openDeveloperPopup()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return null
}
