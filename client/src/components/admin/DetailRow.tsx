/**
 * One label/value line of an admin "Details" list, rendered inside a <dl>.
 * Set `mono` for values read character by character — record ids, mostly —
 * so they are easier to compare and copy.
 */
export default function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex gap-2 py-1 text-sm">
      <dt className="w-36 shrink-0 text-slate-500">{label}</dt>
      <dd className={mono ? 'font-mono text-slate-900' : 'text-slate-900'}>
        {value}
      </dd>
    </div>
  )
}
