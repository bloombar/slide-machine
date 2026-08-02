/**
 * Gemini QuizGenerationProvider (SPEC QUIZ-1). One structured-output call
 * turns a lecture's de-identified slide text into an exit-ticket quiz
 * definition. Like slide generation, the response is requested as JSON and
 * still validated with zod before use — a confused model must never produce
 * a malformed quiz. Publishing to Google Forms is a separate concern handled
 * by the imported Quiz Generator library.
 *
 * Active when QUIZ_PROVIDER=gemini and requires GEMINI_API_KEY; without it
 * the call throws rather than degrading. The mock adapter serves keyless and
 * test runs.
 */
import { z } from 'zod'
import type {
  QuizDefinition,
  QuizGenerationProvider,
  QuizGenerationRequest,
  QuizQuestion,
} from '@slide-machine/shared'
import { env } from '../config/env'
import { registry } from './registry'
import { meterGeminiUsage, type GeminiUsageMetadata } from './usage-metadata'
import { GenerationUnavailableError } from './errors'
import {
  renderAvoidBlock,
  renderInstructionsBlock,
  renderPointsBlock,
  renderQuizPrompt,
  renderSlidesBlock,
  renderTranscriptBlock,
  renderTypesBlock,
} from './quiz-prompt'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** Default number of questions when the request does not specify one. */
const DEFAULT_QUESTION_COUNT = 5
/** Upper bound so a stray large request cannot balloon the output. */
const MAX_QUESTION_COUNT = 20

/** Loose per-question shape; each is validated per `type` after parsing. */
const rawQuestionSchema = z.object({
  type: z.enum(['single_choice', 'multiple_choice', 'short_text', 'long_text']),
  question: z.string().min(1),
  points: z.number().optional(),
  choices: z.array(z.string().min(1)).optional(),
  correctIndex: z.number().int().optional(),
  correctIndexes: z.array(z.number().int()).optional(),
  correctAnswers: z.array(z.string()).optional(),
})

/** Server-side validation of the model's claimed quiz (never trust it). */
const quizSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  questions: z.array(rawQuestionSchema).min(1),
})

/**
 * Validates one model question against its declared type and returns a clean
 * QuizQuestion — or null to drop it (a choice question with too few choices or
 * a drifted correct index would otherwise mark the wrong option correct).
 */
const toQuizQuestion = (
  q: z.infer<typeof rawQuestionSchema>,
): QuizQuestion | null => {
  const base = { question: q.question, points: q.points }
  const choices = q.choices ?? []
  switch (q.type) {
    case 'single_choice': {
      if (
        choices.length < 2 ||
        q.correctIndex === undefined ||
        q.correctIndex < 0 ||
        q.correctIndex >= choices.length
      ) {
        return null
      }
      return {
        ...base,
        type: 'single_choice',
        choices,
        correctIndex: q.correctIndex,
      }
    }
    case 'multiple_choice': {
      const correct = (q.correctIndexes ?? []).filter(
        i => i >= 0 && i < choices.length,
      )
      if (choices.length < 2 || correct.length === 0) return null
      return {
        ...base,
        type: 'multiple_choice',
        choices,
        correctIndexes: correct,
      }
    }
    case 'short_text':
      return {
        ...base,
        type: 'short_text',
        correctAnswers: (q.correctAnswers ?? [])
          .map(a => a.trim())
          .filter(Boolean),
      }
    case 'long_text':
      return { ...base, type: 'long_text' }
  }
}

/** The requested number of questions: the per-type total when given, else the
 * clamped questionCount. */
const requestedCount = (request: QuizGenerationRequest): number => {
  const typeTotal = Object.values(request.typeCounts ?? {}).reduce(
    (sum, n) => sum + (n ?? 0),
    0,
  )
  if (typeTotal > 0) return Math.min(MAX_QUESTION_COUNT, typeTotal)
  return Math.min(
    MAX_QUESTION_COUNT,
    Math.max(1, Math.round(request.questionCount ?? DEFAULT_QUESTION_COUNT)),
  )
}

export class GeminiQuizProvider implements QuizGenerationProvider {
  readonly name = 'gemini'

  async generateQuiz(request: QuizGenerationRequest): Promise<QuizDefinition> {
    if (!env.GEMINI_API_KEY) {
      throw new Error('QUIZ_PROVIDER=gemini requires GEMINI_API_KEY')
    }

    const slides = renderSlidesBlock(request.slides)
    if (!slides) throw new Error('No slide text to generate a quiz from')

    const prompt = renderQuizPrompt({
      types: renderTypesBlock(requestedCount(request), request.typeCounts),
      points: renderPointsBlock(request.totalPoints),
      instructions: renderInstructionsBlock(request.customInstructions),
      slides,
      transcript: renderTranscriptBlock(request.transcript),
      avoid: renderAvoidBlock(request.avoidQuestions),
    })
    if (env.GENERATION_LOG_PROMPTS) {
      console.log(
        `\n===== QUIZ PROMPT (${env.GEMINI_MODEL}) =====\n${prompt}\n===== END PROMPT =====`,
      )
    }

    const res = await fetch(
      `${API_BASE}/models/${env.GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.4,
            maxOutputTokens: 4096,
          },
        }),
        signal: AbortSignal.timeout(env.GEMINI_TIMEOUT_MS),
      },
    )
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      // Quota exhaustion (429) and transient overload (503) become a
      // user-facing "unavailable" error, mirroring slide generation.
      if (res.status === 429 || res.status === 503) {
        console.warn(`Gemini ${res.status}: ${detail.slice(0, 2000)}`)
        throw new GenerationUnavailableError(
          res.status === 429
            ? 'Quiz generation is unavailable — the AI provider is out of quota or credits.'
            : 'Quiz generation is temporarily busy — please try again in a moment.',
          res.status === 503,
        )
      }
      throw new Error(
        `Gemini request failed (${res.status}): ${detail.slice(0, 2000)}`,
      )
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      usageMetadata?: GeminiUsageMetadata
    }
    await meterGeminiUsage(data.usageMetadata)
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (env.GENERATION_LOG_PROMPTS) {
      console.log(
        `===== QUIZ RESPONSE =====\n${text ?? '(no candidate text)'}\n===== END RESPONSE =====`,
      )
    }
    if (!text) throw new Error('Gemini returned no candidate text')

    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new Error('Gemini returned unparseable JSON')
    }

    const result = quizSchema.safeParse(raw)
    if (!result.success) {
      throw new Error('Gemini returned a malformed quiz')
    }

    // Validate each question against its type; drop any that can't form a
    // valid form field (e.g. a choice question with a drifted correct index).
    const questions = result.data.questions
      .map(toQuizQuestion)
      .filter((q): q is QuizQuestion => q !== null)
    if (questions.length === 0) {
      throw new Error('Gemini returned no valid questions')
    }

    return {
      title: result.data.title.trim(),
      description: result.data.description?.trim() || undefined,
      questions,
    }
  }
}

registry.register('quizGeneration', 'gemini', () => new GeminiQuizProvider())
