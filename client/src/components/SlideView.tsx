/**
 * Renders one slide in its template theme, arranged by layoutType
 * (GEN-3 / TMPL-2). Image slots reserve their space (GEN-5): a pulsing
 * skeleton while enrichment is in flight, a quiet static block once it
 * resolves without an image, and a silent fallback if the image itself
 * fails to load — enrichment never surfaces an error.
 */
import { useState } from 'react'
import type { Slide, Template } from '@slide-machine/shared'

interface ThemeColors {
  background: string
  surface: string
  text: string
  muted: string
  accent: string
}

const color = (
  theme: Record<string, unknown>,
  key: string,
  fallback: string,
): string =>
  typeof theme[key] === 'string' ? (theme[key] as string) : fallback

const themeColors = (theme: Record<string, unknown>): ThemeColors => ({
  background: color(theme, 'background', '#0f172a'),
  surface: color(theme, 'surface', '#1e293b'),
  text: color(theme, 'text', '#f1f5f9'),
  muted: color(theme, 'muted', '#94a3b8'),
  accent: color(theme, 'accent', '#38bdf8'),
})

/** Reserved image slot: image when enriched, pulsing skeleton while
 * pending, quiet static block otherwise. */
function ImageSlot({
  slide,
  colors,
  pending,
}: {
  slide: Slide
  colors: ThemeColors
  pending?: boolean
}) {
  const [loadFailed, setLoadFailed] = useState(false)

  if (slide.imageRef && !loadFailed) {
    return (
      <img
        src={slide.imageRef}
        alt={slide.caption ?? ''}
        onError={() => setLoadFailed(true)}
        className="h-full w-full object-cover transition-opacity duration-500"
      />
    )
  }
  if (pending) {
    return (
      <div
        data-testid="image-skeleton"
        className="h-full min-h-32 w-full animate-pulse rounded-lg"
        style={{ backgroundColor: colors.surface }}
      />
    )
  }
  return (
    <div
      data-testid="image-fallback"
      className="h-full min-h-32 w-full rounded-lg"
      style={{ backgroundColor: colors.surface }}
    />
  )
}

export default function SlideView({
  slide,
  template,
  imagePending,
}: {
  slide: Slide
  template: Template
  /** True while background enrichment may still deliver an image (GEN-5). */
  imagePending?: boolean
}) {
  const colors = themeColors(template.theme)

  const body = (
    <>
      {slide.layoutType === 'title' && (
        <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
          <h1 className="text-5xl font-bold">{slide.title}</h1>
          {slide.caption && (
            <p style={{ color: colors.muted }}>{slide.caption}</p>
          )}
        </div>
      )}
      {slide.layoutType === 'section' && (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <div
            className="h-1 w-16 rounded"
            style={{ backgroundColor: colors.accent }}
          />
          <h2 className="text-4xl font-semibold">{slide.title}</h2>
        </div>
      )}
      {slide.layoutType === 'content' && (
        <div className="flex h-full flex-col justify-center gap-6 px-12">
          <h2
            className="text-3xl font-semibold"
            style={{ color: colors.accent }}
          >
            {slide.title}
          </h2>
          <p className="text-xl leading-relaxed">{slide.body}</p>
        </div>
      )}
      {slide.layoutType === 'list' && (
        <div className="flex h-full flex-col justify-center gap-6 px-12">
          <h2
            className="text-3xl font-semibold"
            style={{ color: colors.accent }}
          >
            {slide.title}
          </h2>
          <ul className="flex list-disc flex-col gap-3 pl-8 text-xl">
            {(slide.bullets ?? []).map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {slide.layoutType === 'image-heavy' && (
        <div className="flex h-full flex-col gap-3 p-8">
          <div className="flex-1 overflow-hidden rounded-lg">
            <ImageSlot slide={slide} colors={colors} pending={imagePending} />
          </div>
          {slide.caption && (
            <p className="text-center text-sm" style={{ color: colors.muted }}>
              {slide.caption}
            </p>
          )}
        </div>
      )}
      {slide.layoutType === 'two-column' && (
        <div className="grid h-full grid-cols-2 items-center gap-8 px-12">
          <div className="flex flex-col gap-4">
            <h2
              className="text-3xl font-semibold"
              style={{ color: colors.accent }}
            >
              {slide.title}
            </h2>
            <p className="text-lg leading-relaxed">{slide.body}</p>
          </div>
          <div className="h-3/4 overflow-hidden rounded-lg">
            <ImageSlot slide={slide} colors={colors} pending={imagePending} />
          </div>
        </div>
      )}
      {slide.layoutType === 'quote' && (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-16 text-center">
          <p className="text-3xl font-medium italic">“{slide.body}”</p>
          {slide.caption && (
            <p style={{ color: colors.muted }}>{slide.caption}</p>
          )}
        </div>
      )}
    </>
  )

  return (
    <div
      data-testid="slide"
      data-layout={slide.layoutType}
      className="aspect-video w-full overflow-hidden rounded-xl shadow-2xl"
      style={{ backgroundColor: colors.background, color: colors.text }}
    >
      {body}
    </div>
  )
}
