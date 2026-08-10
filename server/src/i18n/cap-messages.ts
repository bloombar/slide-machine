/**
 * Server-side message catalog for cap notifications (SPEC BILL-8).
 *
 * The server otherwise stays English ([docs/I18N.md](../../../docs/I18N.md)),
 * and deliberately: API error messages are re-keyed and phrased by the client,
 * which knows the reader's language and can word things better than a status
 * code can. Email has no client. A message that arrives hours later, in an
 * inbox, is the one string in the product nobody downstream can translate — so
 * BILL-8 names server catalogs as a dependency rather than an assumption, and
 * this is that dependency, kept as small as it can be.
 *
 * Small means: no i18next, no plural rules, no ICU. A flat map per locale and
 * `{{name}}` substitution. Every message here is a sentence with a number in
 * it, and none of them need more machinery than that. If server-rendered
 * strings ever grow past cap notifications, this is the wrong shape and should
 * be replaced rather than extended.
 *
 * Metric names match the client's `usage.metric.*` bundle word for word. An
 * instructor who reads "Narration" in an email and "Narration" on the usage
 * panel is reading about the same thing, and any drift between the two makes
 * them wonder whether they are.
 */
import type { Locale, UsageMetric } from '@slide-machine/shared'
import { LOCALES } from '@slide-machine/shared'

/** The locale used when an account has never chosen one. */
export const FALLBACK_LOCALE: Locale = 'en'

/** Plain-language names for the metered resources, per locale. */
const METRIC_NAMES: Record<Locale, Record<UsageMetric, string>> = {
  en: {
    aiTokens: 'AI generation',
    sttMinutes: 'Audio recording time',
    diarizationMinutes: 'Speaker identification',
    ttsCharacters: 'Narration',
    ttsPremiumCharacters: 'Premium narration',
    aiImages: 'AI images',
    imageLookups: 'Image searches',
    importMb: 'Imports',
    exports: 'Exports',
    translationCharacters: 'Translation',
    audioStorageMb: 'Stored audio',
    audienceTtsCharacters: 'Narration for viewers',
    audienceLocales: 'Translations for viewers',
  },
  fr: {
    aiTokens: 'Génération par IA',
    sttMinutes: 'Durée d’enregistrement audio',
    diarizationMinutes: 'Identification des intervenants',
    ttsCharacters: 'Narration',
    ttsPremiumCharacters: 'Narration premium',
    aiImages: 'Images par IA',
    imageLookups: 'Recherches d’images',
    importMb: 'Importations',
    exports: 'Exportations',
    translationCharacters: 'Traduction',
    audioStorageMb: 'Audio conservé',
    audienceTtsCharacters: 'Narration pour les spectateurs',
    audienceLocales: 'Traductions pour les spectateurs',
  },
  es: {
    aiTokens: 'Generación con IA',
    sttMinutes: 'Tiempo de grabación de audio',
    diarizationMinutes: 'Identificación de hablantes',
    ttsCharacters: 'Narración',
    ttsPremiumCharacters: 'Narración premium',
    aiImages: 'Imágenes con IA',
    imageLookups: 'Búsquedas de imágenes',
    importMb: 'Importaciones',
    exports: 'Exportaciones',
    translationCharacters: 'Traducción',
    audioStorageMb: 'Audio almacenado',
    audienceTtsCharacters: 'Narración para espectadores',
    audienceLocales: 'Traducciones para espectadores',
  },
  ru: {
    aiTokens: 'Генерация ИИ',
    sttMinutes: 'Время аудиозаписи',
    diarizationMinutes: 'Определение говорящих',
    ttsCharacters: 'Озвучивание',
    ttsPremiumCharacters: 'Премиум-озвучивание',
    aiImages: 'Изображения ИИ',
    imageLookups: 'Поиск изображений',
    importMb: 'Импорт',
    exports: 'Экспорт',
    translationCharacters: 'Перевод',
    audioStorageMb: 'Хранение аудио',
    audienceTtsCharacters: 'Озвучивание для зрителей',
    audienceLocales: 'Переводы для зрителей',
  },
  zh: {
    aiTokens: 'AI 生成',
    sttMinutes: '音频录制时长',
    diarizationMinutes: '说话人识别',
    ttsCharacters: '旁白',
    ttsPremiumCharacters: '高级旁白',
    aiImages: 'AI 图像',
    imageLookups: '图像检索',
    importMb: '导入',
    exports: '导出',
    translationCharacters: '翻译',
    audioStorageMb: '已存音频',
    audienceTtsCharacters: '面向观众的旁白',
    audienceLocales: '面向观众的翻译',
  },
}

/** Keys every locale must define. Exported so a test can assert parity. */
export const CAP_MESSAGE_KEYS = [
  'subject.approaching',
  'subject.reached',
  'greeting',
  'intro.approaching',
  'intro.reached',
  'line.used',
  'line.usedOfCapAudience',
  'resets',
  'resetsNoPeriod',
  'gaugeNote',
  'cta.upgrade',
  'cta.contact',
  'cta.contactNoForm',
  'silence',
  'signoff',
] as const

export type CapMessageKey = (typeof CAP_MESSAGE_KEYS)[number]

/**
 * The sentences themselves.
 *
 * Two rules run through all of them, both from BILL-8:
 *
 *  - **Written for the person reading it.** The resource is named in plain
 *    language, never as a metric identifier, and every message says how much
 *    was used and when it comes back.
 *  - **Counts, never identities.** The audience lines say how many playbacks
 *    or translations were refused. Which students they belonged to is not in
 *    this file because it is not in the notification, and it is not in the
 *    notification because an instructor-facing message must never carry it.
 */
const MESSAGES: Record<Locale, Record<CapMessageKey, string>> = {
  en: {
    'subject.approaching':
      'You are close to a limit on your Slide Machine plan',
    'subject.reached': 'A limit on your Slide Machine plan has been reached',
    greeting: 'Hi {{name}},',
    'intro.approaching':
      'You have used most of this billing period’s allowance for:',
    'intro.reached':
      'This billing period’s allowance has run out, so the following is now blocked:',
    'line.used': '  • {{metric}} — {{used}} of {{cap}} used',
    'line.usedOfCapAudience':
      '  • {{metric}} — {{used}} of {{cap}} used by people viewing your lectures',
    resets: 'Your allowances reset on {{date}}.',
    resetsNoPeriod: 'Your allowances reset at the start of next month.',
    gaugeNote:
      'Stored audio is not a per-period allowance — it is how much you are holding right now, and it goes down when recordings are deleted.',
    'cta.upgrade': 'Upgrading raises every limit: {{link}}',
    'cta.contact':
      'You are already on our largest plan. Get in touch and we will work something out: {{link}}',
    'cta.contactNoForm':
      'You are already on our largest plan. Get in touch and we will work something out.',
    silence:
      'You can turn off these early warnings in your account settings. Notices about a limit actually being reached are always sent.',
    signoff: '— Slide Machine',
  },
  fr: {
    'subject.approaching':
      'Vous approchez d’une limite de votre forfait Slide Machine',
    'subject.reached': 'Une limite de votre forfait Slide Machine est atteinte',
    greeting: 'Bonjour {{name}},',
    'intro.approaching':
      'Vous avez utilisé la majeure partie de votre quota pour cette période :',
    'intro.reached':
      'Le quota de cette période est épuisé ; les éléments suivants sont donc bloqués :',
    'line.used': '  • {{metric}} — {{used}} sur {{cap}} utilisés',
    'line.usedOfCapAudience':
      '  • {{metric}} — {{used}} sur {{cap}} utilisés par les personnes qui consultent vos cours',
    resets: 'Vos quotas sont réinitialisés le {{date}}.',
    resetsNoPeriod: 'Vos quotas sont réinitialisés au début du mois prochain.',
    gaugeNote:
      'L’audio conservé n’est pas un quota par période : c’est ce que vous stockez actuellement, et il diminue quand des enregistrements sont supprimés.',
    'cta.upgrade':
      'Passer à un forfait supérieur augmente toutes les limites : {{link}}',
    'cta.contact':
      'Vous êtes déjà sur notre forfait le plus élevé. Contactez-nous et nous trouverons une solution : {{link}}',
    'cta.contactNoForm':
      'Vous êtes déjà sur notre forfait le plus élevé. Contactez-nous et nous trouverons une solution.',
    silence:
      'Vous pouvez désactiver ces avertissements anticipés dans les paramètres de votre compte. Les avis de limite atteinte sont toujours envoyés.',
    signoff: '— Slide Machine',
  },
  es: {
    'subject.approaching':
      'Estás cerca de un límite de tu plan de Slide Machine',
    'subject.reached': 'Se alcanzó un límite de tu plan de Slide Machine',
    greeting: 'Hola {{name}}:',
    'intro.approaching':
      'Has usado casi todo el cupo de este período de facturación para:',
    'intro.reached':
      'El cupo de este período se agotó, así que lo siguiente está bloqueado:',
    'line.used': '  • {{metric}} — {{used}} de {{cap}} usados',
    'line.usedOfCapAudience':
      '  • {{metric}} — {{used}} de {{cap}} usados por quienes ven tus clases',
    resets: 'Tus cupos se reinician el {{date}}.',
    resetsNoPeriod: 'Tus cupos se reinician al comienzo del próximo mes.',
    gaugeNote:
      'El audio almacenado no es un cupo por período: es lo que guardas ahora mismo, y baja cuando se eliminan grabaciones.',
    'cta.upgrade': 'Mejorar de plan aumenta todos los límites: {{link}}',
    'cta.contact':
      'Ya estás en nuestro plan más grande. Escríbenos y buscaremos una solución: {{link}}',
    'cta.contactNoForm':
      'Ya estás en nuestro plan más grande. Escríbenos y buscaremos una solución.',
    silence:
      'Puedes desactivar estos avisos anticipados en la configuración de tu cuenta. Los avisos de límite alcanzado siempre se envían.',
    signoff: '— Slide Machine',
  },
  ru: {
    'subject.approaching': 'Вы близки к лимиту вашего тарифа Slide Machine',
    'subject.reached': 'Достигнут лимит вашего тарифа Slide Machine',
    greeting: 'Здравствуйте, {{name}}!',
    'intro.approaching':
      'Вы израсходовали почти весь лимит текущего расчётного периода для:',
    'intro.reached':
      'Лимит текущего расчётного периода исчерпан, поэтому заблокировано следующее:',
    'line.used': '  • {{metric}} — использовано {{used}} из {{cap}}',
    'line.usedOfCapAudience':
      '  • {{metric}} — использовано {{used}} из {{cap}} теми, кто смотрит ваши лекции',
    resets: 'Лимиты обновятся {{date}}.',
    resetsNoPeriod: 'Лимиты обновятся в начале следующего месяца.',
    gaugeNote:
      'Хранение аудио — не лимит на период, а объём, который вы храните сейчас; он уменьшается при удалении записей.',
    'cta.upgrade':
      'Переход на более высокий тариф поднимает все лимиты: {{link}}',
    'cta.contact':
      'У вас уже наш самый большой тариф. Напишите нам, и мы что-нибудь придумаем: {{link}}',
    'cta.contactNoForm':
      'У вас уже наш самый большой тариф. Напишите нам, и мы что-нибудь придумаем.',
    silence:
      'Эти ранние предупреждения можно отключить в настройках аккаунта. Уведомления о достигнутом лимите отправляются всегда.',
    signoff: '— Slide Machine',
  },
  zh: {
    'subject.approaching': '您的 Slide Machine 套餐即将达到上限',
    'subject.reached': '您的 Slide Machine 套餐已达上限',
    greeting: '{{name}} 您好：',
    'intro.approaching': '本计费周期以下额度已使用大半：',
    'intro.reached': '本计费周期的额度已用完，以下功能已被暂停：',
    'line.used': '  • {{metric}} — 已使用 {{used}}／{{cap}}',
    'line.usedOfCapAudience':
      '  • {{metric}} — 观看您课程的人已使用 {{used}}／{{cap}}',
    resets: '您的额度将于 {{date}} 重置。',
    resetsNoPeriod: '您的额度将于下月初重置。',
    gaugeNote:
      '已存音频不是按周期计算的额度，而是当前的存储量；删除录音后会减少。',
    'cta.upgrade': '升级套餐可提高所有上限：{{link}}',
    'cta.contact':
      '您已使用我们最高的套餐。请联系我们，我们会为您安排：{{link}}',
    'cta.contactNoForm': '您已使用我们最高的套餐。请联系我们，我们会为您安排。',
    silence: '您可以在账户设置中关闭这些提前提醒。达到上限的通知则始终发送。',
    signoff: '— Slide Machine',
  },
}

/** Substitutes `{{name}}` placeholders. Missing values render as empty rather
 * than leaving the braces on screen. */
const interpolate = (
  template: string,
  vars: Record<string, string | number>,
): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) =>
    String(vars[key] ?? ''),
  )

/** Whether a value is one of the locales we hold messages for. */
const isSupported = (locale: string | undefined): locale is Locale =>
  Boolean(locale) && (LOCALES as readonly string[]).includes(locale as string)

/**
 * A translator bound to one reader's locale. Falls back to English for an
 * account that never chose a language — every account has an inbox, only some
 * have a stored preference, and an English notification is far better than
 * none.
 */
export const capMessages = (
  locale: string | undefined,
): {
  locale: Locale
  t: (key: CapMessageKey, vars?: Record<string, string | number>) => string
  metricName: (metric: UsageMetric) => string
} => {
  const resolved: Locale = isSupported(locale) ? locale : FALLBACK_LOCALE
  return {
    locale: resolved,
    t: (key, vars = {}) => interpolate(MESSAGES[resolved][key], vars),
    // A metric with no entry falls back to its identifier rather than to
    // nothing: an ugly word in an email beats a sentence with a hole in it.
    metricName: metric => METRIC_NAMES[resolved][metric] ?? metric,
  }
}
