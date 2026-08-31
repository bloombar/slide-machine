/**
 * "About us" — what the Slide Machine is, how it works, and where it came
 * from. The one static page with no legal weight, so it is the one written
 * in the product's own voice.
 *
 * A plain constant, unlike the two legal documents: it describes the software
 * rather than the party running it, so there is nothing here for a deployment
 * to configure.
 */
import type { StaticDocument } from './document'

export const ABOUT: StaticDocument = {
  title: 'About us',
  summary: 'Speak freely — the slides will follow.',
  body: `
The Slide Machine turns the relationship between a lecturer and their slides
on its head. Instead of speaking *to* slides prepared hastily by you the night before or long ago by someone you don't even know, you
speak freely and the slides are built *from* what you actually say, live, as you say
it.

## How it works

You start a lecture and talk. Your speech is transcribed and our AI agent
turns your spoken words into well-formatted slides in real-time, with images
we source added at appropriate places as you speak: extending the slide you
are on, or beginning the next slide, using whichever layout suits the material
— a title, a subtitle, a list of bullet points, a paragraph, a big image, or
something else.

A few things happen around that core loop:

- **Seeding.** If you already have an outline, a reading you assigned to
  students, an existing deck, or a set of images that you want included, add
  them and The Slide Machine will use them to help craft the perfect deck. A
  pre-lecture pass can pull out the terms, names and acronyms likely to come
  up, which also teaches the speech recognizer to hear them correctly.
- **Images.** Slides that want a picture get one, whether supplied by you or automatically sourced by the app from public open source
  image libraries, chosen by the model to match what you actually said. We always provide proper attribution and copyright license information for images we use.
- **A whiteboard.** Draw over any slide mid-lecture. Strokes are anchored to
  the words you were speaking at the time, so they replay in step with the
  narration afterwards.
- **Exit-ticket quizzes.** A quiz can be generated from the finished deck and
  published as a Google Form, so the class can answer it on the way out and
  Google can grade it for you.
- **Translated, and read aloud.** A finished lecture can be read in the
  language you pick, and its text spoken aloud in that language — for
  revision, and for students who did not hear it in their first language.
- **Afterwards.** Nothing is frozen when the lecture ends. Slides can be
  edited, re-laid out, refined as a whole, or exported to PDF, YAML, or Google
  Slides.

## Where it came from

The first Slide Machine was created to help its author lecture to 4th grade
elementary school students about what he does for a living. It was an
artisanal browser app with no server and no account system — a proof of
concept that it was possible for technology to help save the lecturer from the
fate of becoming an actor reading lines from a script. The current version you
are using is built better to be usable by a wider audience: accounts, saved
projects, a template library, shareable lectures, usage plans, and a codebase
that student contributors can extend a module at a time.

It is currently being developed into a classroom pilot program in a university
context, with anonymized findings shared with the community, including
identifying the parts that do and do not work in this concept for students and
instructors.

## What we care about

- **You are in control.** This technology is here to assist you, not to get in
  your way or tell you what to say or when to say it. We are actively working
  to maintain the purity of this concept.
- **Your material stays yours.** You can export any lecture in an open format
  and delete any of it, and deletion means deletion (see the
  [Privacy policy](/privacy)).
- **No student data goes to an AI model.** Only de-identified lecture text
  drives generation.
- **No lock-in.** The speech, generation, image and billing engines all sit
  behind interchangeable adapters, so none of them is a permanent commitment
  to a particular AI company or cloud services provider.

## Talk to us

Bug reports, feature requests, and blunt opinions are all welcome — the
[feedback form](/feedback) reaches us directly.
`.trim(),
}
