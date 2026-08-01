/**
 * Read-only view of a lecture's effective seed material for the admin
 * console: the lecture's own notes and files, then the project's stacked
 * underneath. Presentational only — it renders data already fetched with
 * the deck detail, with none of the upload/edit/delete controls the
 * owner-facing SeedMaterial carries.
 *
 * Material the owner removed is listed too, badged as deleted, so an admin
 * can see what fed a lecture's generation even after it was taken away
 * (ADMIN-6). Restoring seed material happens with its lecture or project,
 * so there is no per-asset action here.
 */
import { FileText, Image as ImageIcon } from 'lucide-react'
import type { SeedAsset } from '@slide-machine/shared'
import type { AdminSeedAsset, AdminSeedLevel } from '../../api/admin'
import DeletedBadge, { deletedTextClass } from './DeletedBadge'

const statusLabel: Record<SeedAsset['status'], string> = {
  processing: 'Processing…',
  ready: 'Ready',
  failed: 'Could not extract',
}

const statusClass: Record<SeedAsset['status'], string> = {
  processing: 'bg-amber-50 text-amber-700',
  ready: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-red-50 text-red-700',
}

/** True when a level carries anything worth showing (notes or files). */
const hasSeedMaterial = (level: AdminSeedLevel): boolean =>
  Boolean(level.notes) || level.assets.length > 0

/** One uploaded file/image: thumbnail or icon, name, status, and any
 * caption or extracted-text preview. A removed asset keeps its row, muted
 * and badged. */
function AssetRow({ asset }: { asset: AdminSeedAsset }) {
  return (
    <li className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-2">
      {asset.type === 'image' && asset.imageUrl ? (
        <img
          src={asset.imageUrl}
          alt={asset.caption ?? asset.name}
          className="h-12 w-12 rounded object-cover"
        />
      ) : asset.type === 'image' ? (
        <ImageIcon className="h-5 w-5 text-slate-400" aria-hidden />
      ) : (
        <FileText className="h-5 w-5 text-slate-400" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`truncate text-sm font-medium ${
              asset.deletedAt ? deletedTextClass : ''
            }`}
          >
            {asset.name}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${statusClass[asset.status]}`}
          >
            {statusLabel[asset.status]}
          </span>
          <DeletedBadge deletedAt={asset.deletedAt} />
        </div>
        {asset.caption && (
          <p className="mt-1 text-xs text-slate-500">{asset.caption}</p>
        )}
        {asset.text && (
          <p className="mt-1 line-clamp-4 text-xs whitespace-pre-wrap text-slate-500">
            {asset.text}
          </p>
        )}
      </div>
    </li>
  )
}

/** One level's material under a heading; renders nothing when empty. */
function SeedLevelSection({
  title,
  level,
}: {
  title: string
  level: AdminSeedLevel
}) {
  if (!hasSeedMaterial(level)) return null
  return (
    <section className="mt-4 first:mt-0">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{title}</h3>
      {level.notes && (
        <div className="mb-2 rounded-md bg-slate-50 p-3">
          <p className="mb-1 text-xs font-medium text-slate-500">Seed notes</p>
          <p className="text-sm whitespace-pre-wrap text-slate-800">
            {level.notes}
          </p>
        </div>
      )}
      {level.assets.length > 0 && (
        <ul className="flex flex-col gap-2">
          {level.assets.map(asset => (
            <AssetRow key={asset.id} asset={asset} />
          ))}
        </ul>
      )}
    </section>
  )
}

export default function SeedMaterialView({
  seed,
  projectTitle,
}: {
  seed: { lecture: AdminSeedLevel; project: AdminSeedLevel }
  projectTitle: string
}) {
  return (
    <div>
      <SeedLevelSection title="This lecture" level={seed.lecture} />
      <SeedLevelSection title={`From ${projectTitle}`} level={seed.project} />
    </div>
  )
}
