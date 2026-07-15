/**
 * Seed fixture loader: reads the account roster and lecture-content JSON
 * that sit next to this file and validates them for the seed script
 * ({@link ./seed}). The JSON files are the editable source of truth:
 *
 *   seed-accounts.json      shared login domain + password, and the users
 *   seed-disciplines.json   the courses and their lecture topics
 *
 * Validated with zod at load so a malformed fixture fails loudly rather
 * than seeding garbage (mirrors the template loader). These are
 * development fixtures — do NOT reuse the password anywhere real.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { LOCALES, PLAN_TIERS } from '@slide-machine/shared'

const dir = path.dirname(fileURLToPath(import.meta.url))

/** Reads and parses a JSON fixture against `schema`, failing loudly. */
const loadFixture = <T>(file: string, schema: z.ZodType<T>): T => {
  const raw: unknown = JSON.parse(readFileSync(path.join(dir, file), 'utf8'))
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(
      `Invalid seed fixture ${file}: ${parsed.error.issues
        .map(i => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    )
  }
  return parsed.data
}

const personaSchema = z.object({
  /** Local part of the @seed.slidemachine.dev address. */
  handle: z.string().min(1),
  displayName: z.string().min(1),
  bio: z.string(),
  planTier: z.enum(PLAN_TIERS),
  locale: z.enum(LOCALES),
  profileVisibility: z.enum(['public', 'private']),
  /** Discipline keys this instructor draws their courses from. */
  disciplines: z.array(z.string().min(1)).min(1),
})

const disciplineSchema = z.object({
  key: z.string().min(1),
  /** Project title. */
  course: z.string().min(1),
  /** Project seed context — a short syllabus blurb that layers into
   * generation the same way an instructor's typed notes would. */
  blurb: z.string().min(1),
  /** Lecture topics; each becomes one deck's transcript subject. */
  topics: z.array(z.string().min(1)).min(1),
})

const accountsSchema = z.object({
  domain: z.string().min(1),
  password: z.string().min(1),
  users: z.array(personaSchema).min(1),
})

export type Persona = z.infer<typeof personaSchema>
export type Discipline = z.infer<typeof disciplineSchema>

const accounts = loadFixture('seed-accounts.json', accountsSchema)

/** Email domain for all seed accounts; the wipe key for re-seeds. */
export const SEED_DOMAIN = accounts.domain

/** The password every seed user signs in with (dev only). */
export const SEED_PASSWORD = accounts.password

/** The seed account roster. */
export const PERSONAS: Persona[] = accounts.users

/** The lecture content library. */
export const DISCIPLINES: Discipline[] = loadFixture(
  'seed-disciplines.json',
  z.array(disciplineSchema).min(1),
)
