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
} from '@slide-machine/shared'
import { env } from '../config/env'
import { registry } from './registry'
import { GenerationUnavailableError } from './errors'
import {
  renderAvoidBlock,
  renderQuizPrompt,
  renderSlidesBlock,
  renderTranscriptBlock,
} from './quiz-prompt'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** Default number of questions when the request does not specify one. */
const DEFAULT_QUESTION_COUNT = 5
/** Upper bound so a stray large request cannot balloon the output. */
const MAX_QUESTION_COUNT = 20

/** Server-side validation of the model's claimed quiz (never trust it). */
const quizSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  questions: z
    .array(
      z.object({
        question: z.string().min(1),
        choices: z.array(z.string().min(1)).min(2),
        correctIndex: z.number().int(),
        points: z.number().optional(),
      }),
    )
    .min(1),
})

const clampCount = (n: number | undefined): number =>
  Math.min(
    MAX_QUESTION_COUNT,
    Math.max(1, Math.round(n ?? DEFAULT_QUESTION_COUNT)),
  )

export class GeminiQuizProvider implements QuizGenerationProvider {
  readonly name = 'gemini'

  async generateQuiz(request: QuizGenerationRequest): Promise<QuizDefinition> {
    if (!env.GEMINI_API_KEY) {
      throw new Error('QUIZ_PROVIDER=gemini requires GEMINI_API_KEY')
    }

    const slides = renderSlidesBlock(request.slides)
    if (!slides) throw new Error('No slide text to generate a quiz from')

    const prompt = renderQuizPrompt({
      questionCount: String(clampCount(request.questionCount)),
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
    }
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

    // Keep only questions whose correctIndex points at a real choice; a
    // drifted index would otherwise mark the wrong option correct.
    const questions = result.data.questions.filter(
      q => q.correctIndex >= 0 && q.correctIndex < q.choices.length,
    )
    if (questions.length === 0) {
      throw new Error('Gemini returned no valid questions')
    }

    return {
      title: result.data.title.trim(),
      description: result.data.description?.trim() || undefined,
      questions: questions.map(q => ({
        question: q.question,
        choices: q.choices,
        correctIndex: q.correctIndex,
        points: q.points,
      })),
    }
  }
}

registry.register('quizGeneration', 'gemini', () => new GeminiQuizProvider())
