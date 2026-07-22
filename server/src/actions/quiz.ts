/**
 * Quiz publishing actions (SPEC QUIZ-1..4 via TECH-13). The Quiz tab in
 * lecture settings drives these:
 *   - quiz.status        — is Google connected, and is there a published quiz?
 *   - quiz.connectGoogle — connect a Google account for Drive/Forms access
 *   - quiz.driveFolders  — folders to choose as the Form's destination
 *   - quiz.createFolder  — make a new Drive folder to save quizzes into
 *   - quiz.publish       — generate the quiz and create the Google Form
 *   - quiz.delete        — remove the published quiz (regenerate yields new Qs)
 *
 * Two modes, selected by QUIZ_PUBLISH_MODE:
 *   - 'mock' (tests/dev): connect flips a flag, folders are a fixed list, and
 *     the Form URL is fabricated. No Google contact.
 *   - 'live': connect runs the real offline OAuth flow (returns a consent URL
 *     the client redirects to; the callback stores an encrypted refresh
 *     token), folders come from Drive, and the Form is created for real via
 *     the imported Quiz Generator library.
 * The quiz *content* is always generated for real by the QuizGenerationProvider.
 */
import { z } from 'zod'
import type {
  DriveFolder,
  QuizConnectResult,
  QuizGenerationProvider,
  QuizStatus,
  PublishedQuiz,
  SlideTextContent,
} from '@slide-machine/shared'
import { defineAction } from './define'
import { registerAction, ActionForbiddenError } from './dispatch'
import type { ActionContext } from './context'
import { loadEditableDeck } from './deck'
import { env } from '../config/env'
import { UserModel } from '../models/user'
import { SlideModel } from '../models/slide'
import { registry } from '../providers/registry'
import { publishQuiz } from '../lib/quiz-publish'
import {
  createDriveFolderLive,
  deleteQuizLive,
  listDriveFoldersLive,
  publishQuizLive,
} from '../lib/quiz-google'
import { buildConnectUrl, signConnectState } from '../auth/google-connect'
import { decryptToken } from '../lib/token-crypto'

const isLive = (): boolean => env.QUIZ_PUBLISH_MODE === 'live'

/** Cap on remembered past questions, so the deck doc and the avoid-list
 * prompt cannot grow without bound as an instructor keeps regenerating. */
const MAX_PAST_QUESTIONS = 60

/** Dedupes (case-insensitively) and keeps the most recent past questions. */
const capPastQuestions = (questions: string[]): string[] => {
  const seen = new Set<string>()
  const kept: string[] = []
  for (let i = questions.length - 1; i >= 0; i--) {
    const q = questions[i]!.trim()
    const key = q.toLowerCase()
    if (!q || seen.has(key)) continue
    seen.add(key)
    kept.push(q)
    if (kept.length >= MAX_PAST_QUESTIONS) break
  }
  return kept.reverse()
}

/** Loads the acting user (including the encrypted token), or throws if the
 * account no longer exists. The route's requireAuth guarantees a userId, so a
 * null here means the account was removed after the token was issued. */
const requireUser = async (ctx: ActionContext) => {
  const user = await UserModel.findById(ctx.userId).select(
    '+googleQuizRefreshToken',
  )
  if (!user) throw new ActionForbiddenError('Sign in required')
  return user
}

/**
 * Whether the user can publish. In live mode this requires a stored refresh
 * token — the mock-mode `googleConnected` flag must NOT count as connected
 * once switched to live, or publishing fails with no real Google grant.
 */
const isConnected = (user: {
  googleConnected?: boolean
  googleQuizRefreshToken?: string
}): boolean =>
  isLive()
    ? Boolean(user.googleQuizRefreshToken)
    : Boolean(user.googleConnected)

/** The deck's published quiz mapped to its client shape, or undefined. */
const toPublishedQuiz = (quiz?: {
  formUrl: string
  driveFolderName?: string
  publishedAt: Date
}): PublishedQuiz | undefined =>
  quiz
    ? {
        formUrl: quiz.formUrl,
        driveFolderName: quiz.driveFolderName,
        publishedAt: quiz.publishedAt.toISOString(),
      }
    : undefined

/**
 * Whether Google is connected and the deck's published quiz, if any. Only a
 * deck editor/owner may see this (loadEditableDeck enforces it).
 */
export const quizStatus = defineAction<{ deckId: string }, QuizStatus>({
  name: 'quiz.status',
  input: z.object({ deckId: z.string().min(1) }),
  execute: async (ctx, input) => {
    const user = await requireUser(ctx)
    const { deck } = await loadEditableDeck(ctx, input.deckId)
    return {
      googleConnected: isConnected(user),
      quiz: toPublishedQuiz(deck.quiz),
      hasTranscript: Boolean(deck.transcript?.trim()),
    }
  },
})

/**
 * Connects a Google account for quiz publishing. Mock: flips the flag and
 * reports connected. Live: returns the Google consent URL (with a signed
 * state carrying the user and where to return); the client redirects there,
 * and the connect callback stores the refresh token.
 */
export const quizConnectGoogle = defineAction<
  { returnTo?: string },
  QuizConnectResult
>({
  name: 'quiz.connectGoogle',
  input: z.object({ returnTo: z.string().optional() }),
  execute: async (ctx, input) => {
    const user = await requireUser(ctx)
    if (!isLive()) {
      user.googleConnected = true
      await user.save()
      return { status: 'connected' }
    }
    const state = await signConnectState({
      userId: user.id,
      returnTo: input.returnTo ?? env.PUBLIC_BASE_URL ?? '/',
    })
    // When they signed in with Google, pre-select that same account so the
    // connect is one "Allow" click, not an account chooser. (Sign-in only
    // grants identity scopes, so the Forms/Drive consent is still required.)
    const loginHint = user.googleId ? user.email : undefined
    return { status: 'redirect', url: buildConnectUrl(state, '', loginHint) }
  },
})

/** A small nested folder tree for mock mode, keyed by parent id. Lets the
 * finder UI be navigated without talking to Google. */
const mockFolderTree: Record<string, DriveFolder[]> = {
  root: [
    { id: 'folder-lectures', name: 'Lectures' },
    { id: 'folder-quizzes', name: 'Quizzes' },
    { id: 'folder-exit-tickets', name: 'Exit Tickets' },
  ],
  'folder-lectures': [{ id: 'folder-week1', name: 'Week 1' }],
}

/** The sub-folders inside `parentId` (default My Drive root), for the picker's
 * finder view. Navigating into a folder re-calls this with its id. */
export const quizDriveFolders = defineAction<
  { parentId?: string },
  { folders: DriveFolder[] }
>({
  name: 'quiz.driveFolders',
  input: z.object({ parentId: z.string().optional() }).strict(),
  execute: async (ctx, input) => {
    const user = await requireUser(ctx)
    if (!isConnected(user)) {
      throw new ActionForbiddenError('Connect a Google account first')
    }
    const parentId = input.parentId ?? 'root'
    if (isLive()) {
      const refreshToken = decryptToken(user.googleQuizRefreshToken!)
      return { folders: await listDriveFoldersLive(refreshToken, parentId) }
    }
    return { folders: mockFolderTree[parentId] ?? [] }
  },
})

/**
 * Creates a new Drive folder to save quizzes into (QUIZ-2), returning it so the
 * client can select it. Live: creates it in the instructor's Drive; mock:
 * fabricates a folder id from the name.
 */
export const quizCreateFolder = defineAction<
  { name: string; parentId?: string },
  DriveFolder
>({
  name: 'quiz.createFolder',
  input: z.object({
    name: z.string().trim().min(1).max(120),
    parentId: z.string().optional(),
  }),
  execute: async (ctx, input) => {
    const user = await requireUser(ctx)
    if (!isConnected(user)) {
      throw new ActionForbiddenError('Connect a Google account first')
    }
    const parentId = input.parentId ?? 'root'
    if (isLive()) {
      const refreshToken = decryptToken(user.googleQuizRefreshToken!)
      return createDriveFolderLive(refreshToken, input.name, parentId)
    }
    return {
      id: `folder-${input.name.toLowerCase().replace(/\s+/g, '-')}`,
      name: input.name,
    }
  },
})

/**
 * Generates the exit-ticket quiz from the lecture's slides — optionally
 * folding in the spoken transcript (QUIZ-5) — and publishes it as a Google
 * Form in the chosen Drive folder, returning the shareable URL. Questions from
 * any prior quiz are avoided so a regeneration is genuinely different (QUIZ-6).
 * Generation is always real; the Form creation is mock or live per config.
 */
export const quizPublish = defineAction<
  {
    deckId: string
    driveFolderId: string
    driveFolderName?: string
    includeTranscript?: boolean
  },
  PublishedQuiz
>({
  name: 'quiz.publish',
  input: z.object({
    deckId: z.string().min(1),
    driveFolderId: z.string().min(1),
    driveFolderName: z.string().optional(),
    includeTranscript: z.boolean().optional(),
  }),
  execute: async (ctx, input) => {
    const user = await requireUser(ctx)
    if (!isConnected(user)) {
      throw new ActionForbiddenError('Connect a Google account first')
    }
    const { deck } = await loadEditableDeck(ctx, input.deckId)

    // De-identified slide text, in display order, as the quiz source material.
    const slideDocs = await SlideModel.find({ deckId: deck._id }).sort({
      index: 1,
    })
    const slides: SlideTextContent[] = slideDocs.map(s => ({
      title: s.title,
      body: s.body,
      bullets: s.bullets,
    }))

    // The spoken transcript is folded in only when the instructor opts in.
    const transcript =
      input.includeTranscript && deck.transcript?.trim()
        ? deck.transcript
        : undefined

    // Avoid repeating any question already asked (past deletions + the quiz
    // currently on the deck, if we are replacing it).
    const avoidQuestions = capPastQuestions([
      ...(deck.quizPastQuestions ?? []),
      ...(deck.quiz?.questions ?? []),
    ])

    const provider = registry.get<QuizGenerationProvider>('quizGeneration')
    const quiz = await provider.generateQuiz({
      slides,
      transcript,
      avoidQuestions,
    })

    let published: { formId: string; formUrl: string }
    if (isLive()) {
      // isConnected guarantees a stored token in live mode.
      const refreshToken = decryptToken(user.googleQuizRefreshToken!)
      published = await publishQuizLive(quiz, refreshToken, input.driveFolderId)
    } else {
      published = await publishQuiz({
        quiz,
        driveFolderId: input.driveFolderId,
      })
    }

    deck.quiz = {
      formId: published.formId,
      formUrl: published.formUrl,
      driveFolderId: input.driveFolderId,
      driveFolderName: input.driveFolderName,
      publishedAt: new Date(),
      questions: quiz.questions.map(q => q.question),
    }
    await deck.save()

    return toPublishedQuiz(deck.quiz)!
  },
})

/**
 * Deletes the deck's published quiz (QUIZ-6). The question stems are remembered
 * so a later regeneration avoids them, and in live mode the Google Form is
 * removed from the instructor's Drive on a best-effort basis (a Drive failure
 * must not block forgetting the quiz locally).
 */
export const quizDelete = defineAction<
  { deckId: string },
  { deleted: boolean }
>({
  name: 'quiz.delete',
  input: z.object({ deckId: z.string().min(1) }),
  execute: async (ctx, input) => {
    const user = await requireUser(ctx)
    const { deck } = await loadEditableDeck(ctx, input.deckId)
    if (!deck.quiz) return { deleted: false }

    deck.quizPastQuestions = capPastQuestions([
      ...(deck.quizPastQuestions ?? []),
      ...(deck.quiz.questions ?? []),
    ])

    if (isLive() && user.googleQuizRefreshToken) {
      const refreshToken = decryptToken(user.googleQuizRefreshToken)
      await deleteQuizLive(deck.quiz.formId, refreshToken).catch(() => {})
    }

    deck.set('quiz', undefined)
    await deck.save()
    return { deleted: true }
  },
})

registerAction(quizStatus)
registerAction(quizConnectGoogle)
registerAction(quizDriveFolders)
registerAction(quizCreateFolder)
registerAction(quizPublish)
registerAction(quizDelete)
