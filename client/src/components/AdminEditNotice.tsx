/**
 * The banner an allowlisted admin sees while another user's settings are
 * open (ADMIN-5). The controls beneath it are the owner's own, and behave
 * the same; this says whose settings these are, and that every change is
 * recorded in the admin audit log server-side.
 */
import { useTranslation } from 'react-i18next'

interface Props {
  /** What is being edited, as the sentence names it. */
  entity: 'account' | 'project' | 'lecture'
}

export default function AdminEditNotice({ entity }: Props) {
  const { t } = useTranslation()
  return (
    <p
      role="status"
      className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      {/* An ICU select, not interpolation: the noun's article and
          position vary by language, so translators need the sentence. */}
      {t('common.adminEditNotice', { entity })}
    </p>
  )
}
