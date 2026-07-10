/**
 * Route table. The landing page stays public; /app requires a session.
 */
import { Routes, Route } from 'react-router'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import HomePage from './pages/HomePage'
import ProjectPage from './pages/ProjectPage'
import SessionPage from './pages/SessionPage'
import DeckViewerPage from './pages/DeckViewerPage'
import RequireAuth from './auth/RequireAuth'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/d/:slug" element={<DeckViewerPage />} />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <HomePage />
          </RequireAuth>
        }
      />
      <Route
        path="/app/projects/:projectId"
        element={
          <RequireAuth>
            <ProjectPage />
          </RequireAuth>
        }
      />
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
