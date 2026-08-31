/**
 * Terms & conditions. Like the privacy policy, written against what the
 * application actually does — plans and usage caps (SPEC BILL-*), moderation
 * and bans (ADMIN-4), image licensing obligations (IMG-5), export/import —
 * rather than from a template.
 *
 * It is a **draft pending legal review**: no lawyer has read it, and it names
 * whoever the deployment says runs it (OPERATOR_* in the server environment),
 * falling back to bracketed placeholders per field.
 */
import type { OperatorDetails } from '@slide-machine/shared'
import { draftNotice, resolveOperator, type StaticDocument } from './document'

/** The terms, naming `operator` — by default the configured one. */
export const termsDocument = (
  operator: OperatorDetails = resolveOperator(),
): StaticDocument => ({
  title: 'Terms & conditions',
  summary: 'The agreement between you and us for using the Slide Machine.',
  updated: '5 August 2026',
  body: `
${draftNotice(operator)}

These terms are an agreement between you and ${operator.name} ("we", "us")
covering your use of the Slide Machine ("the service"). By creating an
account or using the service you accept them. If you are using it on behalf
of an institution, you confirm you may bind that institution.

## Your account

You need an account to create anything. Give us an accurate email address,
keep your credentials to yourself, and tell us promptly if you think someone
else has them. You are responsible for what happens under your account. One
account is for one person; accounts are not to be shared or resold.

You must be old enough to enter a contract where you live, and at least 16.

## What you may use it for

Use the service for teaching, learning, presenting and the ordinary work
around them. Do not use it to:

- break the law, or infringe anyone's copyright, trademark, privacy or
  confidentiality;
- upload material you have no right to use, including licensed course
  material you may not redistribute;
- put student personal data — names, identifiers, grades, roster files —
  into lecture material or uploads, where doing so would breach your
  institution's obligations;
- harass, defame, or target anyone, or publish content that does;
- attack, probe, overload, or circumvent the limits of the service, scrape
  it, or resell access to it;
- attempt to make the AI features produce content that any of the above
  would cover.

We can remove content and suspend or terminate accounts that do these
things. Where an account is suspended, the reason is recorded.

## Your content

**You keep ownership of everything you create and upload.** To run the
service we need your permission to do the obvious things with it: store it,
process it, transmit it to the AI and infrastructure providers the service is
built on, render it back to you, and — only where you have chosen to share or
publish something — show it to the people you shared it with. That permission
lasts as long as you keep the content on the service and ends when you delete
it, save for backups already made, which age out on their own schedule.

You are responsible for having the rights to what you upload and for what
your published lectures say.

## AI-generated content

Slides, narration, quizzes, image choices and translations are produced by
statistical models. **They are frequently wrong.** They can invent facts,
misattribute quotations, mangle names, and choose an image that means
something other than you intended. Review anything before you teach from it,
publish it, or grade with it. We make no warranty as to accuracy,
originality, or fitness for any purpose, and we do not claim ownership of
what the models produce for you.

Images added to slides come from third-party sources under their own
licenses. The license and attribution are recorded with each image and shown
on the slide. **Meeting the terms of those licenses — including keeping
attribution intact when you export, publish or present — is yours to do.**

## Third-party services

The service depends on others: AI providers, speech and translation
services, image sources, a payment provider, and — when you connect it —
Google Drive and Google Forms. Their terms apply to their parts, we
do not control them, and an interruption at one of them can interrupt the
feature that uses it.

## Plans, payment and cancellation

The service offers a free tier and paid plans. Prices, allowances and what
each plan includes are shown on the plans page and may change; a change to
what you are paying will not take effect mid-term without notice.

- Subscriptions renew automatically until cancelled. **Cancel at any time**;
  your plan runs to the end of the period you have paid for and then lapses
  to free.
- Payment is handled by our payment provider. Their terms govern the payment
  itself.
- **Usage allowances are per plan and are enforced.** When an allowance runs
  out, the metered feature stops until the period resets or you move up a
  plan. Nothing is billed beyond your plan — there is no overage charge.
- Moving to a smaller plan can shorten how long lecture recordings are kept,
  which can delete recordings you still have. We tell you what would be lost
  before you confirm.
- Except where the law requires otherwise, payments are not refundable.

## Availability

The service is offered as it is and as it is available. It is under active
development, including as a teaching pilot: features change, and there may be
downtime, defects and data-affecting mistakes. We do not promise any level of
availability, and we recommend exporting anything you cannot afford to lose.

## Ending the agreement

You may stop using the service and delete your account at any time. We may
suspend or end an account that breaks these terms, that we are legally
required to act on, or — with reasonable notice — if we discontinue the
service. Deletion follows the process described in the
[Privacy policy](/privacy).

## Liability

To the fullest extent the law allows, we are not liable for indirect,
incidental, or consequential losses, for lost profits, or for lost or
inaccurate content — including anything generated by the AI features. Where
liability cannot be excluded, it is limited to the amount you paid us in the
twelve months before the claim. Nothing here limits liability that cannot
lawfully be limited.

You agree to cover us against claims arising from content you uploaded or
published in breach of these terms.

## Changes

We may update these terms as the service changes. The date at the top says
when they last changed, and material changes will be announced in the
application. Continuing to use the service after a change means you accept
it.

## Law

These terms are governed by the laws of ${operator.jurisdiction}, and its
courts have jurisdiction over disputes arising from them.

## Contact

${operator.name}
${operator.postalAddress}
${operator.contactEmail}
`.trim(),
})
