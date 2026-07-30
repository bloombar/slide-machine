/**
 * The bundle-completeness gate (TECH-12 asks for one in CI). It runs
 * under `npm test`, which CI already runs, so a broken bundle fails
 * locally before it fails there — no extra workflow step.
 *
 * For every locale bundle it checks that:
 *  - the key set is exactly English's — nothing missing, nothing orphaned
 *    (a stale key is as much a bug as a missing one: it means a string
 *    was renamed and one bundle was not followed through)
 *  - every message parses as ICU, so a mismatched brace fails here rather
 *    than silently rendering the raw source at runtime
 *  - the placeholders match English's for the same key, so no message
 *    reads a variable the call site never passes
 *  - no value is blank, which would render as nothing at all
 *
 * Bundles are discovered from disk rather than listed, so adding a locale
 * needs no edit here — only a file, an entry in LOCALES, and one in the
 * direction map.
 */
import { describe, it, expect } from 'vitest'
import {
  parse,
  TYPE,
  type MessageFormatElement,
} from '@formatjs/icu-messageformat-parser'
import { LOCALES } from '@slide-machine/shared'
import en from './locales/en.json'

/** Every bundle file next to English, keyed by its locale tag. */
const bundles: Record<string, Record<string, unknown>> = Object.fromEntries(
  Object.entries(
    import.meta.glob<Record<string, unknown>>('./locales/*.json', {
      eager: true,
      import: 'default',
    }),
  ).map(([path, value]) => [path.replace(/^.*\/(.+)\.json$/, '$1'), value]),
)

/** Bundle metadata (translation provenance) is not a translatable key. */
const META_KEY = '_meta'

/** Flattens nested groups into the dotted keys i18next looks up. */
const flatten = (
  node: Record<string, unknown>,
  prefix = '',
): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(node)) {
    if (!prefix && key === META_KEY) continue
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out[path] = value
    else if (value && typeof value === 'object')
      Object.assign(out, flatten(value as Record<string, unknown>, path))
  }
  return out
}

/** Argument names an ICU message reads, including nested ones. */
const placeholders = (elements: MessageFormatElement[]): string[] => {
  const names = new Set<string>()
  const walk = (nodes: MessageFormatElement[]): void => {
    for (const node of nodes) {
      if (node.type === TYPE.literal || node.type === TYPE.pound) continue
      names.add(node.value)
      if (node.type === TYPE.select || node.type === TYPE.plural) {
        for (const option of Object.values(node.options)) walk(option.value)
      }
    }
  }
  walk(elements)
  return [...names].sort()
}

/** Parses a message, naming the bundle and key when it will not parse. */
const parseOrThrow = (
  locale: string,
  key: string,
  message: string,
): MessageFormatElement[] => {
  try {
    return parse(message)
  } catch (err) {
    throw new Error(
      `${locale}.${key} is not valid ICU: ${(err as Error).message}`,
      { cause: err },
    )
  }
}

const english = flatten(en as unknown as Record<string, unknown>)
const englishKeys = Object.keys(english).sort()
const translations = Object.keys(bundles)
  .filter(locale => locale !== 'en')
  .sort()

describe('locale bundles', () => {
  it('ships exactly one bundle per supported locale', () => {
    expect(Object.keys(bundles).sort()).toEqual([...LOCALES].sort())
  })

  it('has no blank or unparseable English message', () => {
    for (const [key, value] of Object.entries(english)) {
      expect(value.trim(), `en.${key} is blank`).not.toBe('')
      parseOrThrow('en', key, value)
    }
  })

  for (const locale of translations) {
    describe(locale, () => {
      const messages = flatten(bundles[locale]!)

      it('covers exactly the English key set', () => {
        expect(Object.keys(messages).sort()).toEqual(englishKeys)
      })

      it('parses as ICU, reads English’s placeholders, and is never blank', () => {
        for (const [key, value] of Object.entries(messages)) {
          expect(value.trim(), `${locale}.${key} is blank`).not.toBe('')
          const source = english[key]
          if (source === undefined) continue
          expect(
            placeholders(parseOrThrow(locale, key, value)),
            `${locale}.${key} placeholders`,
          ).toEqual(placeholders(parseOrThrow('en', key, source)))
        }
      })
    })
  }
})
