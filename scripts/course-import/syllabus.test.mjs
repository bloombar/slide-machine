/**
 * Unit tests for reading a course description out of a syllabus.
 *
 * The shapes here are the ones the real syllabi use — frontmatter, a
 * `## Course description` section, and sub-sections after it that must not be
 * swept in.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  descriptionFromSyllabus,
  syllabusPathFor,
  readCourseDescription,
} from './syllabus.mjs'

const SYLLABUS = `---
title: Course Syllabus - Software Engineering
description: "Syllabus for the Software Engineering course."
---

\`\`\`txt
Software Engineering
New York University
\`\`\`

## Course description

Taking an engineering approach to the problem of developing software,
students work on a series of short team projects.

### Credits

4 credits

### Modality

This course is **fully online**.
`

describe('descriptionFromSyllabus', () => {
  it('takes the prose under the course-description heading', () => {
    expect(descriptionFromSyllabus(SYLLABUS)).toBe(
      'Taking an engineering approach to the problem of developing software, ' +
        'students work on a series of short team projects.',
    )
  })

  /** Credits and modality are their own sections, not part of the blurb. */
  it('stops at the next heading', () => {
    const text = descriptionFromSyllabus(SYLLABUS)
    expect(text).not.toMatch(/4 credits/)
    expect(text).not.toMatch(/fully online/)
  })

  it('leaves the frontmatter’s own description alone', () => {
    expect(descriptionFromSyllabus(SYLLABUS)).not.toMatch(/Syllabus for the/)
  })

  it('flattens links, code and emphasis into prose', () => {
    const text = descriptionFromSyllabus(
      '## Course description\n\nUses [Zoom](https://x.example) and `git`, ' +
        'which is **required** and _useful_.\n',
    )
    expect(text).toBe('Uses Zoom and git, which is required and useful.')
  })

  it('keeps several paragraphs, separated', () => {
    const text = descriptionFromSyllabus(
      '## Course description\n\nFirst para.\n\nSecond para.\n\n## Next\n',
    )
    expect(text).toBe('First para.\n\nSecond para.')
  })

  it('breaks on a whole paragraph rather than mid-sentence', () => {
    const text = descriptionFromSyllabus(
      `## Course description\n\n${'a'.repeat(80)}\n\n${'b'.repeat(80)}\n`,
      { maxLength: 100 },
    )
    expect(text).toBe('a'.repeat(80))
  })

  it('has nothing to give when there is no such section', () => {
    expect(descriptionFromSyllabus('## Prerequisites\n\nNone.\n')).toBe(null)
    expect(descriptionFromSyllabus('')).toBe(null)
  })

  it('has nothing to give when the section is empty', () => {
    expect(
      descriptionFromSyllabus('## Course description\n\n## Credits\n'),
    ).toBe(null)
  })
})

describe('readCourseDescription', () => {
  let root
  let dir

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'course-syllabus-'))
    dir = path.join(root, 'software-engineering', 'slides')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(root, 'software-engineering', 'syllabus.md'),
      SYLLABUS,
    )
  })

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

  /** The syllabus sits beside `slides/`, at the course root. */
  it('looks for the syllabus at the course root', () => {
    expect(syllabusPathFor(dir)).toBe(
      path.join(root, 'software-engineering', 'syllabus.md'),
    )
  })

  it('reads the description from the course’s own syllabus', () => {
    expect(readCourseDescription(dir)).toMatch(/^Taking an engineering/)
  })

  it('reads a syllabus named explicitly', () => {
    const other = path.join(root, 'other.md')
    fs.writeFileSync(other, '## Course description\n\nSomething else.\n')
    expect(readCourseDescription(dir, { syllabusPath: other })).toBe(
      'Something else.',
    )
  })

  it('returns null when the course has no syllabus', () => {
    expect(readCourseDescription(path.join(root, 'absent', 'slides'))).toBe(
      null,
    )
  })
})
