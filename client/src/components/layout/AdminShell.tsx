/**
 * Layout for the admin console, nested inside the app shell: guards every
 * admin route with RequireAdmin and puts the admin nav bar directly below
 * the app header, above the page's own content.
 */
import { Outlet } from 'react-router'
import RequireAdmin from '../../auth/RequireAdmin'
import AdminNav from '../admin/AdminNav'

export default function AdminShell() {
  return (
    <RequireAdmin>
      <AdminNav />
      <Outlet />
    </RequireAdmin>
  )
}
