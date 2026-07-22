/**
 * Quiz publishing actions (SPEC QUIZ-1..4 via TECH-13). The Quiz tab in
 * lecture settings drives these:
 *   - quiz.status        — is Google connected, and is there a published quiz?
 *   - quiz.connectGoogle — connect a Google account for Drive/Forms access
 *   - quiz.driveFolders  — folders to choose as the Form's destination
 *   - quiz.publish       — generate the quiz and create the Google Form
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
import { listDriveFoldersLive, publishQuizLive } from '../lib/quiz-google'
import { buildConnectUrl, signConnectState } from '../auth/google-connect'
import { decryptToken } from '../lib/token-crypto'

const isLive = (): boolean => env.QUIZ_PUBLISH_MODE === 'live'

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
    return { status: 'redirect', url: buildConnectUrl(state, '') }
  },
})

/** The mock Drive folders offered when not talking to Google. */
const mockDriveFolders: DriveFolder[] = [
  { id: 'root', name: 'My Drive' },
  { id: 'folder-lectures', name: 'Lectures' },
  { id: 'folder-quizzes', name: 'Quizzes' },
  { id: 'folder-exit-tickets', name: 'Exit Tickets' },
]

export const quizDriveFolders = defineAction<
  Record<string, never>,
  { folders: DriveFolder[] }
>({
  name: 'quiz.driveFolders',
  input: z.object({}).strict(),
  execute: async ctx => {
    const user = await requireUser(ctx)
    if (!isConnected(user)) {
      throw new ActionForbiddenError('Connect a Google account first')
    }
    return {
      folders: isLive() ? await listDriveFoldersLive() : mockDriveFolders,
    }
  },
})

/**
 * Generates the exit-ticket quiz from the lecture's slides and publishes it
 * as a Google Form in the chosen Drive folder, returning the shareable URL.
 * Generation is always real; the Form creation is mock or live per config.
 */
export const quizPublish = defineAction<
  { deckId: string; driveFolderId: string; driveFolderName?: string },
  PublishedQuiz
>({
  name: 'quiz.publish',
  input: z.object({
    deckId: z.string().min(1),
    driveFolderId: z.string().min(1),
    driveFolderName: z.string().optional(),
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

    const provider = registry.get<QuizGenerationProvider>('quizGeneration')
    const quiz = await provider.generateQuiz({ slides })

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
    }
    await deck.save()

    return toPublishedQuiz(deck.quiz)!
  },
})

registerAction(quizStatus)
registerAction(quizConnectGoogle)
registerAction(quizDriveFolders)
registerAction(quizPublish)
