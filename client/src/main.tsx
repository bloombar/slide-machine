/**
 * Client entry point: router + auth provider around the app.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { AuthProvider } from './auth/AuthContext'
import { ShellTitleProvider } from './components/layout/ShellTitle'
import { ShellActionsProvider } from './components/layout/ShellActions'
import { loadRuntimeConfig } from './runtime-config'
import { initI18n } from './i18n'
import App from './App'
import './index.css'

const render = (): void => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <ShellTitleProvider>
            <ShellActionsProvider>
              <App />
            </ShellActionsProvider>
          </ShellTitleProvider>
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>,
  )
}

// Two things must be settled before the first paint: the active speech
// engine, so the STT seam resolves correctly at first render, and the
// interface language, so nothing flashes untranslated. Neither is fatal —
// a failed config fetch falls back to the browser engine, and a failed
// bundle load falls back to English.
void Promise.allSettled([loadRuntimeConfig(), initI18n()]).then(render)
