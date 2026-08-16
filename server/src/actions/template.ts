/**
 * Template actions (TMPL-1, TMPL-4).
 *   - template.list      — the caller's library: their own plus the built-ins.
 *   - template.export    — a template serialized to YAML for download (EXP-2).
 *   - template.duplicate — a copy of a template the caller can see, theirs to
 *                          edit. This is also how one is created: starting
 *                          from an existing template means no starter theme or
 *                          layout set is written into code, so a deployment
 *                          shipping its own built-ins is unaffected.
 *   - template.update    — rename, retheme, or retune a template's layouts.
 *   - template.delete    — tombstone a template the caller authored.
 *
 * Built-ins are read-only: they come from files a deployment controls, and
 * editing one into the database would silently diverge from the file it came
 * from. Duplicating gives the user their own copy instead.
 */
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type {
  ExportDownload,
  ExportToDriveResult,
  GenerationProvider,
  Layout,
  Template,
} from '@slide-machine/shared'
import { defineAction } from './define'
import { registerAction, ActionValidationError } from './dispatch'
import {
  parseTemplateImport,
  layoutsWithWhiteboard,
  decorationImages,
  repointDecoration,
} from '../lib/template-import'
import { fetchAssets } from '../import/assets'
import { TemplateModel, toTemplateDto } from '../models/template'
import { UserModel } from '../models/user'
import {
  layoutSchema,
  listBuiltinTemplates,
  normalizeSlot,
  requireWhiteboardLayout,
} from '../templates/builtin'
import { readDriveFileTextLive, driveFileMetaLive } from '../lib/drive-file'
import { readDriveSourceLive } from '../import/read-pptx'
import { listTemplatesFor } from '../templates/resolve'
import { permalinkSlug } from '../lib/slug'
import { templateToYaml } from '../lib/template-yaml'
import { templateToPptx, templatePictures } from '../lib/template-pptx'
import { createGoogleSlidesFromTemplateLive } from '../lib/export-google'
import { decryptToken } from '../lib/token-crypto'
import {
  requiresGoogleDrive,
  signedIn,
  templateAuthor,
  templateReadable,
  templateReadableBySlug,
  type Signed,
  type TemplateAccess,
  type TemplateAuthorAccess,
  type WithGoogle,
} from './access'

/** A design the caller may read: a built-in, their own, one its author
 * shared, or one that draws a lecture they may edit. */
const readableById = templateReadable(
  (input: { templateId: string }) => input.templateId,
)

/** The author alone — renaming, retheming, deleting. */
const authorOf = templateAuthor(
  (input: { templateId: string }) => input.templateId,
)
import { isLive } from '../lib/export-mode'
import { requireExports, requireImportVolume } from '../billing/meter-hooks'
import {
  importPresentation,
  importSourcePresentation,
  assetPrefix,
} from '../import/import-presentation'
import { readPptxLive } from '../import/read-pptx'
import { mockPresentation } from '../import/mock-presentation'
import type { ImportReport } from '../import/build-template'
import { registry } from '../providers/registry'
import { accessTokenFor } from '../auth/google-connect'
import { previewImageUrls } from '../enrichment/preview-images'

/**
 * A name for a copy that says what it came from and which one it is.
 *
 * "Midnight" becomes "Midnight 2", and the next "Midnight 3" — never
 * "Midnight 1", since the original is the first one. Copying a copy counts
 * on from it rather than stacking suffixes, so "Midnight 2" yields
 * "Midnight 3" and not "Midnight 2 2".
 */
export const copyName = (source: string, taken: string[]): string => {
  const base = source.trim().replace(/\s+\d+$/, '') || source.trim()
  const used = new Set(taken.map(n => n.trim()))
  let n = 2
  while (used.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

/** The editable body of a template, validated exactly as a template file is,
 * so a saved template and a shipped one cannot differ in shape. */
const templateBody = z.object({
  name: z.string().trim().min(1).max(80),
  /** `positioned` draws every layout from its boxes; absent keeps the
   * hand-tuned components (docs/TEMPLATES.md §4). */
  renderMode: z.enum(['components', 'positioned']).optional(),
  theme: z.record(z.string(), z.unknown()),
  layouts: z.array(layoutSchema).min(1),
  /** Private until the author shares it: unlisted is reachable by link,
   * public is listed for discovery (TMPL-4). */
  visibility: z.enum(['private', 'unlisted', 'public']).optional(),
})

/** Slots arrive in the file's shorthand or object form; normalizing on save
 * means every reader downstream sees one shape. */
const normalizeLayouts = (
  layouts: z.infer<typeof templateBody>['layouts'],
): Layout[] =>
  layouts.map(layout => ({
    ...layout,
    slots: layout.slots.map(normalizeSlot),
  })) as Layout[]

export const templateList = defineAction<
  Record<string, never>,
  Template[],
  Signed
>({
  name: 'template.list',
  access: signedIn(),
  input: z.object({}),
  execute: async ctx => listTemplatesFor(ctx.userId),
})

/**
 * One template by its permalink (TMPL-4), for the page it is edited on.
 *
 * Carries the author's name so the page can say whose design this is, the
 * way a project page does (SOC-4). Who may read it follows the template's
 * own visibility: its author always, a built-in or a shared one anyone, and
 * a private one nobody else — refused identically to a template that does
 * not exist, so the permalink cannot be used to discover what is there.
 */
export const templateGet = defineAction<
  { slug: string },
  Template,
  TemplateAccess
>({
  name: 'template.get',
  access: templateReadableBySlug((input: { slug: string }) => input.slug),
  input: z.object({ slug: z.string().min(1) }),
  execute: async (ctx, input, { template }) => {
    const owner = await UserModel.findById(template.ownerId).catch(() => null)
    return owner
      ? { ...template, owner: { id: owner.id, displayName: owner.displayName } }
      : template
  },
})

/**
 * Exports a style template to a file (EXP-2), returned inline for the browser
 * to download — the template's identity, theme, and layouts.
 *
 * Two formats, for two different readers. **YAML** is the one this app reads
 * back (EXP-3): it carries slot names, kinds, instructions and limits, none
 * of which PowerPoint has anywhere to put. **PowerPoint** is the one everyone
 * else reads — a deck whose slides are the layouts, openable in Keynote or
 * Office by a colleague who has never heard of this app. It is the same
 * builder the Google Slides export uses, minus the upload.
 *
 * Exporting is a read, so it is gated like one: a private design belongs to
 * its author and to whoever edits a lecture drawn with it, nobody else.
 */
export const templateExport = defineAction<
  { templateId: string; format?: 'yaml' | 'pptx' },
  ExportDownload,
  TemplateAccess
>({
  name: 'template.export',
  access: readableById,
  input: z.object({
    templateId: z.string().min(1),
    format: z.enum(['yaml', 'pptx']).optional(),
  }),
  execute: async (ctx, input, { template }) => {
    const slug =
      template.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'template'
    if (input.format === 'pptx') {
      const pictures = await templatePictures(template)
      const pptx = await templateToPptx(template, pictures)
      return {
        fileName: `${slug}.pptx`,
        mimeType:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        contentBase64: Buffer.from(pptx).toString('base64'),
      }
    }
    return {
      fileName: `${slug}.template.yaml`,
      mimeType: 'application/x-yaml',
      contentBase64: Buffer.from(templateToYaml(template), 'utf8').toString(
        'base64',
      ),
    }
  },
})

/**
 * Copies a template into the caller's library (TMPL-4). The copy carries the
 * source's theme and layouts verbatim, so a new template always starts from
 * something that already renders rather than from an empty shell.
 */
export const templateDuplicate = defineAction<
  { templateId: string; name?: string },
  Template,
  TemplateAccess
>({
  name: 'template.duplicate',
  access: readableById,
  input: z.object({
    templateId: z.string().min(1),
    name: z.string().trim().min(1).max(80).optional(),
  }),
  execute: async (ctx, input, { userId, template: source }) => {
    // Named against everything the caller can already see, so a copy never
    // arrives sharing a name with the thing it was copied from.
    const library = await listTemplatesFor(userId)
    const name =
      input.name ??
      copyName(
        source.name,
        library.map(t => t.name),
      )
    const doc = await TemplateModel.create({
      ownerId: userId,
      name,
      // Its permalink, fixed here and never rewritten: a link to a design
      // must keep working after its author renames it.
      permalinkSlug: permalinkSlug(name, 'template'),
      renderMode: source.renderMode,
      theme: source.theme,
      layouts: source.layouts,
      visibility: 'private',
    })
    return toTemplateDto(doc)
  },
})

/** Renames, rethemes, or retunes a template the caller authored (TMPL-4). */
export const templateUpdate = defineAction<
  {
    templateId: string
    name: string
    renderMode?: 'components' | 'positioned'
    theme: Record<string, unknown>
    layouts: z.infer<typeof templateBody>['layouts']
    visibility?: 'private' | 'unlisted' | 'public'
  },
  Template,
  TemplateAuthorAccess
>({
  name: 'template.update',
  access: authorOf,
  input: z
    .object({ templateId: z.string().min(1) })
    .extend(templateBody.shape)
    .superRefine((body, ctx) => requireWhiteboardLayout(body.layouts, ctx)),
  execute: async (ctx, input, { doc }) => {
    // Templates authored before permalinks get one on their next save. An
    // existing slug is left alone, renames included — see `templateDuplicate`.
    doc.permalinkSlug ??= permalinkSlug(input.name, 'template')
    doc.name = input.name
    doc.renderMode = input.renderMode
    doc.theme = input.theme
    doc.layouts = normalizeLayouts(input.layouts)
    if (input.visibility) doc.visibility = input.visibility
    await doc.save()
    return toTemplateDto(doc)
  },
})

/**
 * Tombstones a template the caller authored (P-10). A deck already using it
 * keeps its id and falls back the way it would for any unknown template, so
 * deleting one never breaks a lecture that referenced it.
 */
export const templateDelete = defineAction<
  { templateId: string },
  { id: string },
  TemplateAuthorAccess
>({
  name: 'template.delete',
  access: authorOf,
  input: z.object({ templateId: z.string().min(1) }),
  execute: async (ctx, input, { doc }) => {
    doc.deletedAt = new Date()
    await doc.save()
    return { id: doc._id.toString() }
  },
})

/**
 * Placeholder pictures for the template editor's preview (TMPL-4).
 *
 * A layout with an empty picture-shaped hole says little about how it looks,
 * so the editor fills its image slots while an author works. Unlike the image
 * picker on a real slide, this costs the caller nothing: nobody browsing their
 * own template should spend an image lookup on a picture that is only there to
 * show what a layout does with one. The results are cached, so clicking
 * between layout tabs makes no request at all.
 */
export const templatePreviewImage = defineAction<
  { query?: string; count?: number },
  { urls: string[] },
  Signed
>({
  name: 'template.previewImage',
  access: signedIn(),
  input: z.object({
    query: z.string().trim().min(1).max(60).optional(),
    count: z.number().int().min(1).max(8).optional(),
  }),
  execute: async (_ctx, input) => ({
    urls: await previewImageUrls(input.query, input.count ?? 1),
  }),
})

/**
 * Exports a template to the caller's Google Drive as a native Google Slides
 * presentation whose layouts are the template's layouts (EXP-6).
 *
 * A template in Google Slides is not a document of a special kind — it is a
 * presentation whose layouts define a design, which is what people copy and
 * build on. So this produces exactly that, with one demonstration slide per
 * layout so the design is visible on open.
 *
 * Metered like any other export, and needs no OAuth scope beyond the one
 * already used to create files: the presentation is produced as a .pptx and
 * converted by Drive.
 */
export const templateExportToDrive = defineAction<
  { templateId: string; driveFolderId: string; driveFolderName?: string },
  ExportToDriveResult,
  WithGoogle<TemplateAccess>
>({
  name: 'template.exportToDrive',
  // Two requirements, and the order matters: the design must be one the
  // caller may read before the account is asked for a Google connection.
  // A built-in is exportable too — taking a shipped design into Drive to
  // build on is the same act as taking one you wrote.
  access: requiresGoogleDrive(readableById, 'export'),
  meter: requireExports,
  input: z.object({
    templateId: z.string().min(1),
    driveFolderId: z.string().min(1),
    driveFolderName: z.string().optional(),
  }),
  execute: async (ctx, input, { template, googleUser: user }) => {
    const name = template.name.trim() || 'Untitled design'

    let fileId: string
    let fileUrl: string
    if (!isLive()) {
      // A random suffix keeps every mock export distinct, as the deck path does
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      fileId = `mock-template-${slug}-${randomBytes(4).toString('hex')}`
      fileUrl = `https://docs.google.com/presentation/d/${fileId}/edit`
    } else {
      const file = await createGoogleSlidesFromTemplateLive(
        decryptToken(user.googleQuizRefreshToken!),
        { ...template, name },
        input.driveFolderId,
      )
      fileId = file.id
      fileUrl = file.fileUrl
    }

    return {
      fileId,
      fileName: name,
      fileUrl,
      format: 'google-slides',
      driveFolderName: input.driveFolderName,
      exportedAt: new Date().toISOString(),
    }
  },
})

/**
 * Derives a template from a presentation in the caller's Google Drive
 * (TMPL-8).
 *
 * An instructor with a deck they already like should not have to rebuild its
 * design in an editor. This reads that presentation, works out the few designs
 * it is really built from, and saves them as a template of their own.
 *
 * The result is **private and editable**, never applied to anything. An import
 * is a guess — a good one, and still a guess — so what it produces is a
 * starting point the author reviews, not a change to a lecture.
 *
 * Needs no OAuth scope beyond the one already used to browse Drive: reading a
 * presentation is covered by `drive.readonly`, which is verified rather than
 * assumed (docs/TEMPLATES.md §11).
 */
export const templateImportFromSlides = defineAction<
  {
    presentationId?: string
    pptxBase64?: string
    name?: string
    keepEverySlide?: boolean
  },
  { template: Template; report: ImportReport },
  WithGoogle<Signed>
>({
  name: 'template.importFromSlides',
  access: requiresGoogleDrive(signedIn(), 'export'),
  // Against the import allowance, not the export one: this brings a design in
  // (SPEC BILL-3). The model call inside is metered on its own.
  meter: requireImportVolume,
  input: z
    .object({
      presentationId: z.string().trim().min(1).max(120).optional(),
      /** A PowerPoint file's bytes instead of a presentation id. Google does
       * the reading: the file is converted in the caller's Drive and taken
       * away again (see `read-pptx.ts`). */
      pptxBase64: z.string().min(1).optional(),
      name: z.string().trim().min(1).max(80).optional(),
      /** Give every slide a layout of its own instead of consolidating the
       * deck into the few designs it is built from (TMPL-8). */
      keepEverySlide: z.boolean().optional(),
    })
    // One source or the other, never both and never neither — a request that
    // named two would leave the server picking, which is not its choice.
    .refine(v => Boolean(v.presentationId) !== Boolean(v.pptxBase64), {
      message: 'Give either a presentation id or a PowerPoint file, not both',
    }),
  execute: async (_ctx, input, { userId, googleUser: user }) => {
    const provider = registry.get<GenerationProvider>('generation')
    // Mock mode reads a deliberately messy sample deck rather than Google, so
    // the suite and a machine with no credentials exercise every consolidation
    // pass — the same reason every other Google-touching feature has one.
    const keep = input.keepEverySlide ? { keepEverySlide: true } : {}
    // A PowerPoint file is read by converting it in the caller's Drive and
    // taking it away again; from there it is the same presentation every
    // other import reads.
    const source =
      input.pptxBase64 && isLive()
        ? await readPptxLive(decryptToken(user.googleQuizRefreshToken!), {
            name: input.name ?? 'Imported presentation',
            data: Buffer.from(input.pptxBase64, 'base64'),
          })
        : undefined

    // Mock mode reads a deliberately messy sample deck rather than Google, so
    // the suite and a machine with no credentials exercise every consolidation
    // pass — the same reason every other Google-touching feature has one.
    const { template: built, report } = source
      ? await importSourcePresentation(source, {
          provider,
          assetPrefix: assetPrefix(userId, source.title || 'pptx'),
          ...keep,
        })
      : isLive() && input.presentationId
        ? await importPresentation({
            accessToken: await accessTokenFor(
              decryptToken(user.googleQuizRefreshToken!),
            ),
            presentationId: input.presentationId,
            ownerId: userId,
            provider,
            ...keep,
          })
        : await importSourcePresentation(
            mockPresentation(input.presentationId ?? 'pptx'),
            { provider, ...keep },
          )

    // An imported design still has to satisfy the same schema a hand-written
    // one does — a template the editor cannot open would be worse than none.
    const layouts = z.array(layoutSchema).parse(built.layouts)
    const name = input.name ?? built.name

    const doc = await TemplateModel.create({
      ownerId: userId,
      name,
      permalinkSlug: permalinkSlug(name, 'template'),
      renderMode: built.renderMode,
      theme: built.theme,
      layouts: normalizeLayouts(layouts),
      visibility: 'private',
    })
    return { template: toTemplateDto(doc), report }
  },
})

/**
 * Round-trip import of a template YAML (EXP-3). Takes the document
 * `template.export` produced and recreates it as a new template in the
 * caller's library.
 *
 * ## It fails rather than substitutes
 *
 * A deck import that cannot resolve something falls back and warns, because
 * the lecture's content is still worth recovering. A template has nothing to
 * fall back to, so every problem here refuses the whole import (EXP-3). That
 * covers a malformed file and, just as importantly, a picture that would not
 * come: a design imported without its logo is not the design, and saying so
 * is better than handing back something that looks nearly right.
 *
 * ## The pictures become the new template's own
 *
 * Decoration names files stored under the exporting template's prefix.
 * Pointing at those would make one library's design depend on another's, and
 * would leave the copy broken when the original is deleted and its assets
 * swept (P-11). So each picture is fetched and re-stored under this
 * template's prefix before anything is written.
 */
const storeImportedTemplate = async (
  actionName: string,
  content: string,
  userId: string,
  override?: string,
): Promise<Template> => {
  const parsed = parseTemplateImport(content)
  if ('errors' in parsed) {
    throw new ActionValidationError(actionName, parsed.errors)
  }

  const layouts = layoutsWithWhiteboard(parsed.data)
  const name = override ?? parsed.data.name

  // Fetched before the template is written, so a picture that will not come
  // leaves nothing behind to clean up.
  const images = decorationImages(layouts)
  let stored = new Map<string, string>()
  if (images.length) {
    const prefix = `templates/import/${userId}/${randomBytes(8).toString('hex')}`
    stored = (await fetchAssets(images, prefix)).stored
    const missing = images.filter(url => !stored.has(url))
    if (missing.length) {
      throw new ActionValidationError(actionName, [
        `Could not retrieve ${missing.length} of the design's ${images.length} pictures, so the template was not imported. Export it again from a library that still has them, or remove them from the file.`,
        ...missing.map(url => `picture: ${url}`),
      ])
    }
  }

  const doc = await TemplateModel.create({
    ownerId: userId,
    name,
    permalinkSlug: permalinkSlug(name, 'template'),
    ...(parsed.data.renderMode ? { renderMode: parsed.data.renderMode } : {}),
    theme: parsed.data.theme,
    layouts: normalizeLayouts(repointDecoration(layouts, stored)),
    // An import is the author's to review before anyone else sees it, the
    // same judgement an import from Google Slides makes.
    visibility: 'private',
  })
  return toTemplateDto(doc)
}

export const templateImport = defineAction<
  { content: string; name?: string },
  Template,
  Signed
>({
  name: 'template.import',
  access: signedIn(),
  meter: requireImportVolume,
  input: z.object({
    content: z.string().min(1),
    name: z.string().trim().min(1).max(80).optional(),
  }),
  execute: async (_ctx, input, { userId }) =>
    storeImportedTemplate('template.import', input.content, userId, input.name),
})

/**
 * The same import, from a template file kept in the caller's connected Drive
 * (EXP-3: "imports may come from an upload or a connected account").
 *
 * A pasted link rather than a file browser, for the reason the Slides import
 * takes one: the instructor already has the file open in Drive and its address
 * is in their clipboard, so a browser would be a second thing to learn for the
 * same result.
 *
 * Only the fetching differs. Once the bytes are in hand, a file from Drive and
 * a file from disk are the same file, and are imported by the same code — so
 * neither route can drift into accepting something the other refuses.
 */
export const templateImportFromDrive = defineAction<
  { fileId: string; name?: string },
  Template,
  WithGoogle<Signed>
>({
  name: 'template.importFromDrive',
  // The same surface the Slides import is gated by: both read a file out of
  // the connected Drive, and both follow EXPORT_MODE into live or mock.
  access: requiresGoogleDrive(signedIn(), 'export'),
  meter: requireImportVolume,
  input: z.object({
    fileId: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(80).optional(),
  }),
  execute: async (_ctx, input, { userId, googleUser: user }) => {
    if (isLive()) {
      const refreshToken = decryptToken(user.googleQuizRefreshToken!)
      const token = await accessTokenFor(refreshToken)
      const meta = await driveFileMetaLive(token, input.fileId)

      // A link says nothing about what it points at, so the file is asked.
      // A presentation or a PowerPoint is a design to derive (TMPL-8);
      // anything else is read as the design file this app exported (EXP-3).
      if (
        meta.mimeType === 'application/vnd.google-apps.presentation' ||
        meta.mimeType ===
          'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ) {
        const source = await readDriveSourceLive(refreshToken, input.fileId)
        const provider = registry.get<GenerationProvider>('generation')
        const { template: built } = await importSourcePresentation(source, {
          provider,
          assetPrefix: assetPrefix(userId, input.fileId),
        })
        const layouts = z.array(layoutSchema).parse(built.layouts)
        const name = input.name ?? built.name
        const doc = await TemplateModel.create({
          ownerId: userId,
          name,
          permalinkSlug: permalinkSlug(name, 'template'),
          renderMode: built.renderMode,
          theme: built.theme,
          layouts: normalizeLayouts(layouts),
          visibility: 'private',
        })
        return toTemplateDto(doc)
      }

      return storeImportedTemplate(
        'template.importFromDrive',
        await readDriveFileTextLive(token, input.fileId),
        userId,
        input.name,
      )
    }

    // Mock-backed like every other Google-touching path, so the suite and a
    // machine with no credentials exercise the whole import. A built-in
    // serialized through the real exporter, so mock mode reads exactly the
    // document a live Drive file would hold.
    return storeImportedTemplate(
      'template.importFromDrive',
      templateToYaml(listBuiltinTemplates()[0]!),
      userId,
      input.name,
    )
  },
})

registerAction(templateList)
registerAction(templateGet)
registerAction(templateExport)
registerAction(templatePreviewImage)
registerAction(templateDuplicate)
registerAction(templateUpdate)
registerAction(templateDelete)
registerAction(templateExportToDrive)
registerAction(templateImportFromSlides)
registerAction(templateImport)
registerAction(templateImportFromDrive)
