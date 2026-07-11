/**
 * Client entry point: router + auth provider around the app.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { AuthProvider } from './auth/AuthContext'
import { ShellTitleProvider } from './components/layout/ShellTitle'
import App from './App'
import './index.css'

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
