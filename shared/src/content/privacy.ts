/**
 * Privacy policy. Written from what the application actually does — the
 * privacy requirements in docs/SPEC.md §16 (P-1..P-13) plus the retention,
 * billing and connected-account behaviour they describe — rather than from a
 * template, so that every claim here corresponds to code that exists.
 *
 * It is a **draft pending legal review**: no lawyer has read it, and it names
 * whoever the deployment says runs it (OPERATOR_* in the server environment),
 * falling back to bracketed placeholders per field.
 */
import type { OperatorDetails } from '../dto/config'
import { draftNotice, type StaticDocument } from './document'

/** The policy, naming `operator`. The caller supplies it: the client reads
 * it from runtime config, the server from its own environment. */
export const privacyDocument = (operator: OperatorDetails): StaticDocument => ({
  title: 'Privacy policy',
  summary:
    'What the Slide Machine collects, why, and what you can do about it.',
  updated: '5 August 2026',
  body: `
${draftNotice(operator)}

The Slide Machine ("the service") is operated by ${operator.name}
("we", "us"). This policy explains what personal data the service handles,
why, who else sees it, and how long it is kept. It covers the application at
this domain, not any third-party site you reach from it.

## What we collect

**Your account.** Your email address, display name, a hash of your password
(never the password itself), and anything you choose to add — a bio, a
profile picture, your interface and lecturing languages, and whether your
profile is public or private. If you sign in with Google, we receive your
email address, name and profile picture from Google instead of a password.

**What you create.** Projects, lectures, slides, spoken transcripts,
whiteboard drawings, style templates, quizzes, and any material you upload to
seed a project — documents, slide decks, images, notes.

**Live speech.** While a lecture is recording, microphone audio is
transcribed into text. We may also keep the recording itself — it lets a
lecture be re-transcribed, refined, its speakers separated, its original
narration replayed per slide, and its quality analysed. **How long a
recording is kept depends on your plan and on what still has to be done with
it.** A kept recording is stored server-side only, is never exposed through
the API to anyone without edit access to that lecture, and is deleted once
its retention window passes.

**Usage.** Counts of the metered things you do — minutes transcribed, slides
generated, images fetched, characters narrated — so that plan allowances can
be applied and the service's own costs understood.

**Billing.** If you subscribe, our payment provider handles the payment. We
store only a customer reference and your subscription's status. **We never
see or store card numbers.**

**Connected accounts.** If you connect Google Drive, we store the resulting
access tokens encrypted, so that exports and quiz publishing can act on your
behalf. Tokens are never sent to your browser and you can
disconnect at any time.

**Technical records.** Ordinary server logs (request paths, timestamps,
error traces) and, for administrators only, an audit log described below.

## What we do with it

We use this data to run the service: to sign you in, generate and store your
lectures, apply your plan's allowances, bill you if you subscribe, and
respond when you contact us. We do not sell it, and we do not use it for
advertising or behavioural profiling.

## AI processing

Generating slides means sending text to an AI provider. What is sent is the
lecture's own content — what was spoken, what you seeded, what is already on
the slides — and it is **de-identified**: no student names, rosters, grades,
or other personally identifying information about students are sent to any
external model.

Other features contact third parties in the same narrow way: image search
sends the search terms a slide implies to openly licensed image sources;
narration sends slide or transcript text to a speech-synthesis provider;
translated viewing sends slide text to a translation provider. Each of these
is a service-provider relationship, and none of those providers is permitted
to use your content to train their models beyond what their own terms
require of them at the time.

Which providers a given deployment uses is a configuration choice, and the
operator can name them on request.

## Student data

Where the service is used for teaching, student data — rosters, quiz
responses, scores — stays inside the institution's own approved systems.
Exit-ticket quizzes are created in **your** Google account and live in
**your** Drive; responses go to you, not to us. We hold no student roster and
no student results.

## Sharing and visibility

Most of what you create is private to you until you share it. When you do:

- A lecture given a **share link** is readable by anyone who has that link,
  and, if you publish it, listed publicly.
- A **public profile** shows your display name, bio and public lectures to
  anyone; a private one shows nothing.
- **Votes** you cast are attributed to your account internally, so a vote can
  be changed, and are shown to others only as totals.

Sharing is reversible. Making something private again removes it from every
public surface.

## How long we keep it

**Deletion is a two-stage process, and both stages are real.** When you
delete a lecture, a project, an upload or your whole account, it is
immediately marked deleted: it disappears from your account, from search, and
from every shared link, and its children go with it — deleting a project
deletes its lectures. It remains recoverable for a limited window (90 days by
default) in case the deletion was a mistake, and administrators can see it
during that window in order to restore it.

After that window, a scheduled sweep **permanently erases** the records and
the stored files behind them — uploads, exports, retained audio, synthesized
narration — with no copy left to restore from.

Retained lecture audio is deleted sooner: after the retention window your
plan provides, or as soon as the processing it was kept for has finished.
Moving to a smaller plan can shorten that window, and you are told what would
be deleted before the change is made.

## Security

Passwords are hashed. Session tokens are signed, short-lived, and refreshed
through a cookie your browser will not expose to scripts. Connected-account
tokens are encrypted at rest. Every credential the service needs lives in
server-side configuration and is never sent to the browser. Every request
that reads or changes something checks that the account making it is allowed
to.

No system is perfectly secure, and we do not claim otherwise.

## Administrative access

A small, named allowlist of operators can reach the administration console.
Its members can see accounts and content — including private content — in
order to run the service and respond to reports. Two limits apply to that
power: any action that exposes a user's private content or credentials
requires an explicit confirmation first, and **every such action is written
to an append-only audit log** — who did it, to whom, when — that no part of
the application can edit or erase.

## Cookies and local storage

We use one cookie: the session refresh cookie that keeps you signed in. It is
strictly necessary, and there is no advertising, analytics or third-party
tracking cookie on this service. Your browser's local storage holds only your
interface-language choice.

## Your choices

You can, at any time and without asking us:

- **See and correct** everything on your account from account settings.
- **Export** any lecture as PDF, YAML, or a Google Slides presentation.
- **Delete** any lecture, project, upload — or your entire account, which
  takes your content with it.
- **Control visibility** of your profile and of each lecture.
- **Disconnect** Google, and **cancel** a subscription.

Depending on where you live you may also have statutory rights of access,
correction, portability, erasure, and objection. Write to
${operator.contactEmail} and we will honour them.

## Research

Where the service runs as a teaching pilot, its effectiveness is studied.
Data used for that is **anonymized before analysis** and the study is subject
to institutional review. Findings are shared with the academic community
whether they are flattering or not.

## Children

The service is built for higher education and is not directed at children.
We do not knowingly create accounts for anyone under 16.

## Changes

We will update this page when the service changes, and the date at the top
will say when. Material changes will be announced in the application rather
than made quietly.

## Contact

${operator.name}
${operator.postalAddress}
${operator.contactEmail}
`.trim(),
})
