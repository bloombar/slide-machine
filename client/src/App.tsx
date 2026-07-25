/**
 * Route table. Every screen keeps the top navigation: public pages
 * (including the permalink viewer) use the PublicShell, authenticated
 * pages use the AppShell. Admin pages nest one level deeper in the
 * AdminShell, which guards them and adds the admin nav bar.
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
import AdminProjectsPage from './pages/AdminProjectsPage'
import AdminProjectPage from './pages/AdminProjectPage'
import AdminDecksPage from './pages/AdminDecksPage'
import AdminDeckPage from './pages/AdminDeckPage'
import AdminLogsPage from './pages/AdminLogsPage'
import RequireAuth from './auth/RequireAuth'
import AdminShell from './components/layout/AdminShell'

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
        <Route path="/app/admin" element={<AdminShell />}>
          <Route index element={<AdminUsersPage />} />
          <Route path="users/:userId" element={<AdminUserDetailPage />} />
          <Route path="projects" element={<AdminProjectsPage />} />
          <Route path="projects/:projectId" element={<AdminProjectPage />} />
          <Route path="decks" element={<AdminDecksPage />} />
          <Route path="decks/:deckId" element={<AdminDeckPage />} />
          <Route path="logs" element={<AdminLogsPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
