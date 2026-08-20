/**
 * The per-unit vendor prices the current configuration can actually incur
 * (SPEC BILL-6/BILL-7) — config/service-prices.json filtered server-side to
 * the providers, models, and voices that are switched on right now.
 *
 * These are the rates the cost figures above were computed from, shown so an
 * operator can check what the deployment pays without shelling into the
 * server. The list is rebuilt from the config on every request, so a rate
 * edit shows on the next refresh. Display only: changing a price stays a
 * config edit, deliberately not an admin form — recorded cost is frozen when
 * written, and history never re-prices.
 */
import { useEffect, useState } from 'react'
import type {
  ConfiguredPrice,
  ServicePricesResponse,
} from '@slide-machine/shared'
import { fetchServicePrices } from '../../api/cost'

/** A per-unit rate. Up to four decimals: many rates are fractions of a cent
 * ($0.016 per minute), and rounding to cents would show them as free. */
const rate = (value: number, currency: string): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value)

const percent = (value: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(value)

/** "$0.30 per 1M input tokens" / "2.9% of each charge". */
const priceText = (line: ConfiguredPrice, currency: string): string =>
  `${line.kind === 'percent' ? percent(line.rate) : rate(line.rate, currency)} ${line.unit}`

export default function ServicePricesPanel() {
  const [prices, setPrices] = useState<ServicePricesResponse | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    fetchServicePrices()
      .then(body => live && setPrices(body))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [])

  return (
    <section aria-labelledby="service-prices-heading" className="mt-8">
      <h2
        id="service-prices-heading"
        className="mb-1 text-lg font-semibold text-slate-700"
      >
        Configured prices
      </h2>
      {failed && (
        <p role="alert" className="text-red-600">
          Could not load the configured prices.
        </p>
      )}
      {!failed && !prices && <p className="text-slate-500">Loading…</p>}
      {prices && (
        <>
          <p className="mb-3 text-xs text-slate-500">
            What the services this deployment is currently configured to use
            cost per unit, from{' '}
            <code className="rounded bg-slate-100 px-1">
              service-prices.json
            </code>{' '}
            (last verified {prices.asOf}, figures in {prices.currency}). Read
            live from the configuration — a config change shows here on the next
            refresh. The cost figures above were priced at the rates in force
            when each event happened; a rate change never re-prices history.
          </p>
          {prices.prices.length === 0 ? (
            <p className="text-sm text-slate-500">
              No paid services are active in the current configuration.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500 uppercase">
                  <tr>
                    <th scope="col" className="py-2">
                      Service
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Price
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {prices.prices.map(line => (
                    <tr
                      key={`${line.service}|${line.detail ?? ''}|${line.unit}`}
                      className="border-t border-slate-100"
                    >
                      <td className="py-2">
                        <span>{line.service}</span>
                        {line.detail && (
                          <span className="ml-2 text-xs text-slate-500">
                            {line.detail}
                          </span>
                        )}
                        {line.note && (
                          <p className="text-xs text-slate-400">{line.note}</p>
                        )}
                      </td>
                      <td className="py-2 text-right tabular-nums whitespace-nowrap">
                        {priceText(line, prices.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}
