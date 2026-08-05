/**
 * Route table. Every screen keeps the top navigation: public pages
 * (including the permalink viewer) use the PublicShell, authenticated
 * pages use the AppShell. Admin pages nest one level deeper in the
 * AdminShell, which guards them and adds the admin nav bar.
 */
import { Navigate, Routes, Route } from 'react-router'
import PublicShell from './components/layout/PublicShell'
import AppShell from './components/layout/AppShell'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import HomePage from './pages/HomePage'
import ProjectPage from './pages/ProjectPage'
import ProfilePage from './pages/ProfilePage'
import AccountSettingsPage from './pages/AccountSettingsPage'
import PlanPricingPage from './pages/PlanPricingPage'
import DeckViewerPage from './pages/DeckViewerPage'
import AboutPage from './pages/AboutPage'
import FeedbackPage from './pages/FeedbackPage'
import PrivacyPolicyPage from './pages/PrivacyPolicyPage'
import TermsPage from './pages/TermsPage'
import AdminUsersPage from './pages/AdminUsersPage'
import AdminUserDetailPage from './pages/AdminUserDetailPage'
import AdminProjectsPage from './pages/AdminProjectsPage'
import AdminProjectPage from './pages/AdminProjectPage'
import AdminDecksPage from './pages/AdminDecksPage'
import AdminDeckPage from './pages/AdminDeckPage'
import AdminLogsPage from './pages/AdminLogsPage'
import AdminSettingsLogsPage from './pages/AdminSettingsLogsPage'
import RequireAuth from './auth/RequireAuth'
import AdminShell from './components/layout/AdminShell'
import { useAuth } from './auth/AuthContext'

/** The profile page moved to /u/:userId, where owner and stranger see
 * the same page. Old links to /app/profile land on the signed-in user's
 * own one; RequireAuth guarantees there is a user by the time this runs. */
function OwnProfileRedirect() {
  const { user } = useAuth()
  return user ? <Navigate to={`/u/${user.id}`} replace /> : null
}

export default function App() {
  return (
    <Routes>
      <Route element={<PublicShell />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/d/:slug" element={<DeckViewerPage />} />
        <Route path="/u/:userId" element={<ProfilePage />} />
        {/* Static pages. Public on purpose: a privacy policy nobody can read
            without an account is no policy, and the feedback form is most
            useful to someone who cannot get in. */}
        <Route path="/about" element={<AboutPage />} />
        <Route path="/feedback" element={<FeedbackPage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/terms" element={<TermsPage />} />
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
        <Route path="/app/profile" element={<OwnProfileRedirect />} />
        {/* One canonical place to change anything about an account (AUTH-5);
            the :userId form is how an admin edits someone else's (ADMIN-5). */}
        <Route path="/app/settings" element={<AccountSettingsPage />} />
        {/* Comparing plans needs a page of its own; settings links here. */}
        <Route path="/app/plans" element={<PlanPricingPage />} />
        <Route path="/app/settings/:userId" element={<AccountSettingsPage />} />
        <Route path="/app/admin" element={<AdminShell />}>
          <Route index element={<AdminUsersPage />} />
          <Route path="users/:userId" element={<AdminUserDetailPage />} />
          <Route path="projects" element={<AdminProjectsPage />} />
          <Route path="projects/:projectId" element={<AdminProjectPage />} />
          <Route path="decks" element={<AdminDecksPage />} />
          <Route path="decks/:deckId" element={<AdminDeckPage />} />
          <Route path="logs" element={<AdminLogsPage />} />
          <Route path="settings-logs" element={<AdminSettingsLogsPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
