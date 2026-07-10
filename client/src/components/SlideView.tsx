/**
 * Renders one slide in its template theme, arranged by layoutType
 * (GEN-3 / TMPL-2). Image slots show a pulsing skeleton until image
 * enrichment lands (GEN-5's reserved-slot behavior).
 */
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

/** Reserved image slot: real image when enriched, skeleton until then. */
function ImageSlot({ slide, colors }: { slide: Slide; colors: ThemeColors }) {
  if (slide.imageRef) {
    return (
      <img
        src={slide.imageRef}
        alt={slide.caption ?? ''}
        className="h-full w-full object-cover"
      />
    )
  }
  return (
    <div
      data-testid="image-skeleton"
      className="flex h-full min-h-32 w-full animate-pulse items-center justify-center rounded-lg"
      style={{ backgroundColor: colors.surface }}
    >
      <span className="text-sm" style={{ color: colors.muted }}>
        image
      </span>
    </div>
  )
}

export default function SlideView({
  slide,
  template,
}: {
  slide: Slide
  template: Template
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
            <ImageSlot slide={slide} colors={colors} />
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
            <ImageSlot slide={slide} colors={colors} />
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
