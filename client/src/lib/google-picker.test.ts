/**
 * Unit tests for the Google Picker wrapper (EXP-4).
 *
 * Three things here are load-bearing and invisible if wrong. The app id has to
 * reach the builder, because it is what ties a picked file's grant to this
 * OAuth client — get it wrong and the pick succeeds while the server's later
 * read 404s. The importable views have to include the files shared *with* the
 * instructor, since a deck they were given but never added to their Drive is
 * exactly the one they want. And closing the picker has to resolve, not hang.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  openGooglePicker,
  FOLDER_MIME,
  IMPORTABLE_MIMES,
} from './google-picker'

/** What a view was configured with, recorded as the builders are called. */
interface ViewRecord {
  viewId: string
  includeFolders?: boolean
  selectFolderEnabled?: boolean
  mimeTypes?: string
  ownedByMe?: boolean
}

let views: ViewRecord[]
let built: Record<string, unknown>
let fire: (data: unknown) => void

/** Stands in for the library Google's script would install. */
const stubPickerApi = () => {
  views = []
  built = {}
  class DocsView {
    record: ViewRecord
    constructor(viewId: string) {
      this.record = { viewId }
      views.push(this.record)
    }
    setIncludeFolders(on: boolean) {
      this.record.includeFolders = on
      return this
    }
    setSelectFolderEnabled(on: boolean) {
      this.record.selectFolderEnabled = on
      return this
    }
    setMimeTypes(types: string) {
      this.record.mimeTypes = types
      return this
    }
    setOwnedByMe(owned: boolean) {
      this.record.ownedByMe = owned
      return this
    }
  }
  class PickerBuilder {
    setAppId(v: string) {
      built.appId = v
      return this
    }
    setOAuthToken(v: string) {
      built.token = v
      return this
    }
    setDeveloperKey(v: string) {
      built.key = v
      return this
    }
    setLocale(v: string) {
      built.locale = v
      return this
    }
    addView(v: unknown) {
      built.views = [...((built.views as unknown[]) ?? []), v]
      return this
    }
    enableFeature(v: string) {
      built.features = [...((built.features as string[]) ?? []), v]
      return this
    }
    setCallback(cb: (data: unknown) => void) {
      fire = cb
      return this
    }
    build() {
      return {
        setVisible: (visible: boolean) => {
          built.visible = visible
        },
      }
    }
  }
  ;(window as unknown as { google: unknown }).google = {
    picker: {
      DocsView,
      PickerBuilder,
      ViewId: { DOCS: 'DOCS', FOLDERS: 'FOLDERS' },
      Action: { PICKED: 'picked', CANCEL: 'cancel' },
      Feature: { SUPPORT_DRIVES: 'supportDrives' },
    },
  }
}

/**
 * Opens the picker and waits for the builder to run.
 *
 * The result is wrapped rather than returned: an async function that returned
 * the promise would await it, and it does not settle until the user picks.
 */
const open = async (kind: 'folder' | 'importable') => {
  const picked = openGooglePicker({
    apiKey: 'browser-key',
    appId: '1234567890',
    accessToken: 'ya29.fresh',
    kind,
    locale: 'fr',
  })
  // The library loads through a promise, so the builder runs a tick later.
  await new Promise(resolve => setTimeout(resolve, 0))
  return { picked }
}

beforeEach(stubPickerApi)
afterEach(() => {
  delete (window as unknown as { google?: unknown }).google
})

describe('opening the picker', () => {
  it('carries the app id, the token and the browser key', async () => {
    const { picked } = await open('folder')
    // The app id is the whole reason the server can read the file afterwards.
    expect(built.appId).toBe('1234567890')
    expect(built.token).toBe('ya29.fresh')
    expect(built.key).toBe('browser-key')
    expect(built.locale).toBe('fr')
    expect(built.visible).toBe(true)
    fire({ action: 'cancel' })
    await picked
  })

  it('shows shared drives, which hold plenty of real teaching material', async () => {
    const { picked } = await open('importable')
    expect(built.features).toContain('supportDrives')
    fire({ action: 'cancel' })
    await picked
  })
})

describe('what the user is offered', () => {
  it('offers folders only, selectable, when choosing a destination', async () => {
    const { picked } = await open('folder')
    expect(views).toEqual([
      {
        viewId: 'FOLDERS',
        includeFolders: true,
        selectFolderEnabled: true,
        mimeTypes: FOLDER_MIME,
      },
    ])
    fire({ action: 'cancel' })
    await picked
  })

  it('offers their own files and the ones shared with them, when importing', async () => {
    const { picked } = await open('importable')
    expect(views).toHaveLength(2)
    expect(views[0]!.mimeTypes).toBe(IMPORTABLE_MIMES.join(','))
    // The second view is the one that reaches a deck a colleague shared and
    // the instructor never added to their Drive.
    expect(views[1]!.ownedByMe).toBe(false)
    fire({ action: 'cancel' })
    await picked
  })
})

describe('what comes back', () => {
  it('is the file the user chose', async () => {
    const { picked } = await open('importable')
    fire({
      action: 'picked',
      docs: [
        {
          id: 'file-1',
          name: 'Photosynthesis',
          mimeType: 'application/vnd.google-apps.presentation',
        },
      ],
    })
    await expect(picked).resolves.toEqual({
      id: 'file-1',
      name: 'Photosynthesis',
      mimeType: 'application/vnd.google-apps.presentation',
    })
  })

  it('is nothing when they closed it, rather than a promise left hanging', async () => {
    const { picked } = await open('folder')
    fire({ action: 'cancel' })
    await expect(picked).resolves.toBeNull()
  })

  it('is nothing when Google reports a pick with no file in it', async () => {
    const { picked } = await open('folder')
    fire({ action: 'picked', docs: [] })
    await expect(picked).resolves.toBeNull()
  })
})
