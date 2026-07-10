/**
 * Route table. Public pages and the authenticated app share their
 * respective layout shells; presentation surfaces (live session, deck
 * viewer) render chrome-free for full-screen slides.
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
      </Route>
      <Route path="/d/:slug" element={<DeckViewerPage />} />
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
      </Route>
      <Route
        path="/app/session/:deckId"
        element={
          <RequireAuth>
            <SessionPage />
          </RequireAuth>
        }
      />
    </Routes>
  )
}
