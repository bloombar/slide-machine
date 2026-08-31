/**
 * Google's own file chooser (EXP-4).
 *
 * The app holds one Drive scope, `drive.file`, which is per-file: it reaches
 * what this app created and what the user hands it. It cannot list a Drive,
 * so the app cannot draw its own browser. The Picker is how Google intends
 * that gap to be filled — it runs in Google's iframe on the user's own
 * session, shows them everything they can see, and returns the one thing they
 * chose, granting this app access to exactly that.
 *
 * Loaded on demand: the script is Google's, and a page that never opens a
 * picker should not fetch it.
 */

/** What the user chose. `mimeType` decides which import route it takes, and
 * tells a folder from a file. */
export interface PickedDriveItem {
  id: string
  name: string
  mimeType: string
}

/** Choosing somewhere to save, or something to read. */
export type DrivePickerKind = 'folder' | 'importable'

/** Drive folders are a mime type like any other file. */
export const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** What an import can read: a presentation to derive from (TMPL-8/EXP-5), a
 * PowerPoint to convert, or a design file this app exported earlier (EXP-3).
 * Anything else in the Drive is noise to someone choosing what to import. */
export const IMPORTABLE_MIMES = [
  'application/vnd.google-apps.presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/x-yaml',
  'text/yaml',
  'text/plain',
]

/** The slice of Google's picker API this module uses. Declared rather than
 * depended on: the library arrives at runtime from Google's script, and the
 * whole surface is four builders. */
interface PickerView {
  setIncludeFolders(on: boolean): PickerView
  setSelectFolderEnabled(on: boolean): PickerView
  setMimeTypes(types: string): PickerView
  setOwnedByMe(owned: boolean): PickerView
}
interface PickerBuilder {
  setAppId(appId: string): PickerBuilder
  setOAuthToken(token: string): PickerBuilder
  setDeveloperKey(key: string): PickerBuilder
  setLocale(locale: string): PickerBuilder
  addView(view: PickerView): PickerBuilder
  enableFeature(feature: string): PickerBuilder
  setCallback(cb: (data: PickerResponse) => void): PickerBuilder
  build(): { setVisible(visible: boolean): void }
}
interface PickerResponse {
  action: string
  docs?: Array<{ id: string; name: string; mimeType: string }>
}
interface GooglePickerApi {
  DocsView: new (viewId?: string) => PickerView
  PickerBuilder: new () => PickerBuilder
  ViewId: { DOCS: string; FOLDERS: string }
  Action: { PICKED: string; CANCEL: string }
  Feature: { SUPPORT_DRIVES: string }
}
interface GapiHost {
  gapi?: { load(name: string, cb: () => void): void }
  google?: { picker?: GooglePickerApi }
}

const SCRIPT_SRC = 'https://apis.google.com/js/api.js'

let loading: Promise<GooglePickerApi> | null = null

/** Loads Google's picker library once, resolving with it. Repeat calls share
 * the one load; a failure clears the cache so a later attempt can retry. */
const loadPicker = (): Promise<GooglePickerApi> => {
  const host = window as unknown as GapiHost
  const ready = host.google?.picker
  if (ready) return Promise.resolve(ready)

  loading ??= new Promise<GooglePickerApi>((resolve, reject) => {
    const done = () => {
      host.gapi?.load('picker', () => {
        const api = host.google?.picker
        if (api) resolve(api)
        else reject(new Error('Google picker did not load'))
      })
    }
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`,
    )
    if (existing) {
      // Already on the page from an earlier open that is still in flight.
      existing.addEventListener('load', done)
      existing.addEventListener('error', () =>
        reject(new Error('Google picker script failed to load')),
      )
      if (host.gapi) done()
      return
    }
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = done
    script.onerror = () =>
      reject(new Error('Google picker script failed to load'))
    document.head.appendChild(script)
  }).catch((err: Error) => {
    loading = null
    throw err
  })
  return loading
}

/** The views to offer, by what is being chosen. Two for importing — the user's
 * own files and the ones shared with them — because a presentation an
 * instructor was given but never added to their Drive is exactly the deck they
 * want to import, and the default view would not show it. */
const viewsFor = (api: GooglePickerApi, kind: DrivePickerKind): PickerView[] =>
  kind === 'folder'
    ? [
        new api.DocsView(api.ViewId.FOLDERS)
          .setIncludeFolders(true)
          .setMimeTypes(FOLDER_MIME)
          .setSelectFolderEnabled(true),
      ]
    : [
        new api.DocsView(api.ViewId.DOCS)
          .setIncludeFolders(true)
          .setMimeTypes(IMPORTABLE_MIMES.join(',')),
        new api.DocsView(api.ViewId.DOCS)
          .setOwnedByMe(false)
          .setIncludeFolders(true)
          .setMimeTypes(IMPORTABLE_MIMES.join(',')),
      ]

/**
 * Opens Google's picker and resolves with what was chosen, or `null` if the
 * user closed it without choosing.
 *
 * `appId` is the Cloud project number, and it is load-bearing: it is what ties
 * the picked file's grant to this OAuth client, so that the *server* — reading
 * later from the stored refresh token, not from `accessToken` — is allowed to
 * open the file. Get it wrong and the pick appears to succeed while every
 * later read 404s.
 */
export const openGooglePicker = ({
  apiKey,
  appId,
  accessToken,
  kind,
  locale,
}: {
  apiKey: string
  appId: string
  accessToken: string
  kind: DrivePickerKind
  locale?: string
}): Promise<PickedDriveItem | null> =>
  loadPicker().then(
    api =>
      new Promise<PickedDriveItem | null>(resolve => {
        let builder = new api.PickerBuilder()
          .setAppId(appId)
          .setOAuthToken(accessToken)
          .setDeveloperKey(apiKey)
          // Files kept on a shared drive are still the instructor's to teach
          // from, and are invisible without this.
          .enableFeature(api.Feature.SUPPORT_DRIVES)
          .setCallback(data => {
            if (data.action === api.Action.PICKED) {
              const doc = data.docs?.[0]
              resolve(
                doc
                  ? { id: doc.id, name: doc.name, mimeType: doc.mimeType }
                  : null,
              )
            } else if (data.action === api.Action.CANCEL) {
              resolve(null)
            }
          })
        if (locale) builder = builder.setLocale(locale)
        for (const view of viewsFor(api, kind)) builder = builder.addView(view)
        builder.build().setVisible(true)
      }),
  )
