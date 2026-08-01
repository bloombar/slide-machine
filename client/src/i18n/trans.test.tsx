/**
 * The five messages that carry an element inside the sentence go through
 * <Trans> rather than t(). ICU parses them with `ignoreTag: true`, so the
 * tags survive the ICU pass as literal text for Trans to interpolate —
 * this pins that the two actually cooperate, in every locale.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Trans } from 'react-i18next'
import { LOCALES } from '@slide-machine/shared'
import { i18n } from './index'

/** Each Trans key with the components its call site passes. */
const CASES: Array<{
  key: string
  values?: Record<string, unknown>
  components: Record<string, React.ReactElement>
  /** A child the message must place, by test id. */
  expects: string
}> = [
  {
    key: 'layout.fromTemplate',
    values: { name: 'Classic' },
    components: { strong: <strong data-testid="marker" /> },
    expects: 'marker',
  },
  {
    key: 'deck.settings.scope',
    components: { projectLink: <a href="/p" data-testid="marker" /> },
    expects: 'marker',
  },
  {
    key: 'refine.slide.intro',
    components: { lectureLink: <button data-testid="marker" /> },
    expects: 'marker',
  },
  {
    key: 'deck.empty.howToStart',
    components: {
      plus: <span data-testid="marker" />,
      mic: <span data-testid="mic-marker" />,
    },
    expects: 'marker',
  },
  {
    key: 'project.new.description',
    components: { hint: <span data-testid="marker" /> },
    expects: 'marker',
  },
]

afterEach(cleanup)

describe.each([...LOCALES])('<Trans> messages in %s', locale => {
  it.each(CASES.map(c => [c.key, c] as const))(
    'places the element inside %s',
    async (_key, testCase) => {
      await i18n.changeLanguage(locale)
      render(
        <Trans
          i18nKey={testCase.key}
          values={testCase.values}
          components={testCase.components}
        />,
      )
      const marker = screen.getByTestId(testCase.expects)
      expect(marker).toBeInTheDocument()
      // The tag was interpolated, not left as literal source text
      expect(document.body.textContent).not.toContain('<')
    },
  )
})
