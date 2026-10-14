import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { DeveloperModeProvider, DeveloperWindowHost } from './developer'
import { LoginScreen } from './screens/LoginScreen'
import './index.css'
import './ai-sdlc-theme.css'
import './desktop-perf.css'
import { isBlinkDesktopShell } from './desktop/detect'

function Root() {
  const { session } = useAuth()
  return (
    <>
      {session ? <App /> : <LoginScreen />}
      <DeveloperWindowHost />
    </>
  )
}

const blinkTree = (
  <DeveloperModeProvider>
    <AuthProvider>
      <Root />
    </AuthProvider>
  </DeveloperModeProvider>
)

createRoot(document.getElementById('root')!).render(
  isBlinkDesktopShell() ? blinkTree : <StrictMode>{blinkTree}</StrictMode>,
)
