/**
 * Client entry point: router + auth provider around the app.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { AuthProvider } from './auth/AuthContext'
import { ShellTitleProvider } from './components/layout/ShellTitle'
import { loadRuntimeConfig } from './runtime-config'
import App from './App'
import './index.css'

const render = (): void => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <ShellTitleProvider>
            <App />
          </ShellTitleProvider>
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>,
  )
}

// Learn the active speech engine before mounting so the STT seam resolves
// correctly at first render; a failed fetch falls back to the browser engine.
loadRuntimeConfig().finally(render)
