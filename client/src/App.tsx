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
import DeckViewerPage from './pages/DeckViewerPage'
import PublicProfilePage from './pages/PublicProfilePage'
import AdminUsersPage from './pages/AdminUsersPage'
import AdminUserDetailPage from './pages/AdminUserDetailPage'
import AdminProjectPage from './pages/AdminProjectPage'
import AdminDeckPage from './pages/AdminDeckPage'
import AdminLogsPage from './pages/AdminLogsPage'
import RequireAuth from './auth/RequireAuth'
import RequireAdmin from './auth/RequireAdmin'

export default function App() {
  return (
    <Routes>
      <Route element={<PublicShell />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/d/:slug" element={<DeckViewerPage />} />
        <Route path="/u/:userId" element={<PublicProfilePage />} />
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
        <Route
          path="/app/admin"
          element={
            <RequireAdmin>
              <AdminUsersPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/app/admin/users/:userId"
          element={
            <RequireAdmin>
              <AdminUserDetailPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/app/admin/projects/:projectId"
          element={
            <RequireAdmin>
              <AdminProjectPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/app/admin/decks/:deckId"
          element={
            <RequireAdmin>
              <AdminDeckPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/app/admin/logs"
          element={
            <RequireAdmin>
              <AdminLogsPage />
            </RequireAdmin>
          }
        />
      </Route>
    </Routes>
  )
}
