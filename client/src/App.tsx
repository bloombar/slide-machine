/**
 * Route table. Every screen keeps the top navigation: public pages
 * (including the permalink viewer) use the PublicShell, authenticated
 * pages use the AppShell.
 */
import { Routes, Route } from 'react-router'
import PublicShell from './components/layout/PublicShell'
import AppShell from './components/layout/AppShell'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import HomePage from './pages/HomePage'
import ProjectPage from './pages/ProjectPage'
import ProfilePage from './pages/ProfilePage'
import SessionPage from './pages/SessionPage'
import DeckViewerPage from './pages/DeckViewerPage'
import RequireAuth from './auth/RequireAuth'

export default function App() {
  return (
    <Routes>
      <Route element={<PublicShell />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/d/:slug" element={<DeckViewerPage />} />
      </Route>
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/app" element={<HomePage />} />
        <Route path="/app/projects/:projectId" element={<ProjectPage />} />
        <Route path="/app/profile" element={<ProfilePage />} />
        <Route path="/app/session/:deckId" element={<SessionPage />} />
      </Route>
    </Routes>
  )
}
