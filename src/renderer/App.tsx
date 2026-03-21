import { useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ipc } from './lib/ipc'
import Today from './views/Today'
import Focus from './views/Focus'
import History from './views/History'
import Apps from './views/Apps'
import Insights from './views/Insights'
import Settings from './views/Settings'
import Onboarding from './views/Onboarding'
import type { AppTheme } from '@shared/types'

function applyTheme(theme: AppTheme | undefined) {
  const root = document.documentElement
  if (theme === 'light' || theme === 'dark') {
    root.dataset.theme = theme
    return
  }
  delete root.dataset.theme
}

export default function App() {
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true

    void ipc.settings.get().then((settings) => {
      if (!active) return
      applyTheme(settings.theme)
      setOnboardingComplete(settings.onboardingComplete)
    })

    const onThemeChange = (event: Event) => {
      applyTheme((event as CustomEvent<AppTheme>).detail)
    }

    window.addEventListener('daylens:theme-changed', onThemeChange as EventListener)

    return () => {
      active = false
      window.removeEventListener('daylens:theme-changed', onThemeChange as EventListener)
    }
  }, [])

  // Loading — wait for settings before rendering anything
  if (onboardingComplete === null) return null

  if (!onboardingComplete) {
    return <Onboarding onComplete={() => setOnboardingComplete(true)} />
  }

  return (
    <HashRouter>
      {/* Full-height shell: title bar on top, sidebar + content below */}
      <div className="flex flex-col h-full overflow-hidden">
        <TitleBar />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto bg-[var(--color-surface)]">
            <Routes>
              <Route path="/" element={<Navigate to="/today" replace />} />
              <Route path="/today" element={<ErrorBoundary name="Today"><Today /></ErrorBoundary>} />
              <Route path="/focus" element={<ErrorBoundary name="Focus"><Focus /></ErrorBoundary>} />
              <Route path="/history" element={<ErrorBoundary name="History"><History /></ErrorBoundary>} />
              <Route path="/apps" element={<ErrorBoundary name="Apps"><Apps /></ErrorBoundary>} />
              <Route path="/insights" element={<ErrorBoundary name="Insights"><Insights /></ErrorBoundary>} />
              <Route path="/settings" element={<ErrorBoundary name="Settings"><Settings /></ErrorBoundary>} />
            </Routes>
          </main>
        </div>
      </div>
    </HashRouter>
  )
}
