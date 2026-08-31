# Email setup (DreamHost mailbox for theslidemachine.com)

The app needs one thing from a mail provider: an **SMTP account it can log in
to and send as**. Everything else here — an inbox you can read, the DNS records
that keep the mail out of spam folders — exists so that the address it sends
from is a real, trusted address on our own domain.

Today production sends as `parrhesia@wonkledge.com`, which is a different
domain from the product. This document sets up `theslidemachine.com` addresses
instead.

## Can mail live at DreamHost while the site lives at DigitalOcean?

**Yes.** A domain does not point somewhere as a whole — each *record type*
points somewhere on its own. Web traffic follows `A`/`AAAA`; mail follows `MX`.
They are independent, and pointing one has no effect on the other.

Our DNS is hosted at DigitalOcean (`ns1`–`ns3.digitalocean.com`), and the apex
`A`/`AAAA` records point at App Platform. Adding `MX` records for DreamHost
alongside them does not touch the website.

**One correction to the obvious mental model.** Inbound mail for
`you@theslidemachine.com` is routed by the `MX` record on **the apex**
(`theslidemachine.com`), not by a `mail.` subdomain. A host named
`mail.theslidemachine.com` only matters if you want addresses that literally
end `@mail.theslidemachine.com`. We don't — so there is no `mail.` record in
this guide.

And do **not** point `mail.theslidemachine.com` at DreamHost to use as a mail
client hostname. DreamHost's TLS certificate covers `*.dreamhost.com`, so a
client connecting to a CNAME of ours would see a certificate-name mismatch.
Mail clients should use `imap.dreamhost.com` / `smtp.dreamhost.com` directly.

## What you will end up with

| Piece | Value |
| --- | --- |
| Mailbox | `noreply@theslidemachine.com` (app sender) |
| Mailbox | `feedback@theslidemachine.com` (where the form lands) |
| Sending host | `smtp.dreamhost.com:587`, STARTTLS |
| DNS added at DigitalOcean | `MX` on apex, `TXT` SPF on apex, `TXT` DKIM, `TXT` DMARC |

Two mailboxes rather than one keeps the app's outgoing address separate from a
human inbox, so a reply to a verification email does not land in the same place
as a bug report. Use one if you'd rather; set both env vars to it.

## 1. Add the domain for mail at DreamHost

In the DreamHost panel, add `theslidemachine.com` and choose the option that
hosts **mail only** — the website stays where it is. DreamHost does not need to
serve the site or hold the DNS for this to work; it only needs to accept the
domain so it can create mailboxes and sign outgoing mail for it.

If the panel insists on taking over DNS, decline: we keep DNS at DigitalOcean
and copy the records across by hand in step 3. That is the supported path —
DreamHost documents it for domains whose DNS is managed elsewhere.

## 2. Create the mailboxes

**Mail → Manage Email → Create New Email Address**, twice:

- `noreply@theslidemachine.com`
- `feedback@theslidemachine.com`

Use a generated password of real length for `noreply` — it goes into a secret,
never into anyone's mail client. Save both somewhere durable before leaving the
page; DreamHost will not show the password again.

## 3. Copy the DNS records to DigitalOcean

**This is the step everything else depends on**, and the one place to be
careful: the values below are *shapes*, not values to paste. DreamHost shows
your account's real records under **Manage Websites → DNS Settings** for the
domain. Read them there and copy those.

Add each at DigitalOcean (**Networking → Domains → theslidemachine.com**, or
`doctl compute domain records create`).

### MX — where our mail arrives

DreamHost uses one of two pairs depending on whether spam filtering is on:

| Filtering | Hostnames |
| --- | --- |
| On | `mx1.mailchannels.net`, `mx2.mailchannels.net` |
| Off | `mx1.dreamhost.com`, `mx2.dreamhost.com` |

Both records go on `@` with **equal priority** (DreamHost uses `0` for both, so
the two are a redundant pair rather than a primary and a backup). Take the pair
the panel actually shows you.

### TXT — SPF, which says who may send as us

One record on `@`. DreamHost's own domains use:

```
v=spf1 mx include:netblocks.dreamhost.com include:relay.mailchannels.net -all
```

A domain may have **only one** SPF record. `theslidemachine.com` currently has
a `google-site-verification` TXT record, which is fine — that is a separate TXT
record, and only SPF records conflict with each other.

### TXT — DKIM, which signs our mail

DreamHost enables DKIM automatically, but **only writes the record for you if
it also holds your DNS**. Ours is at DigitalOcean, so this one must be copied
by hand or outgoing mail goes unsigned.

Name: `dreamhost._domainkey`. Value: a long `v=DKIM1; k=rsa; ...` string from
the panel. Copy it exactly — a truncated key fails closed and every message
looks forged.

### TXT — DMARC, which tells receivers what to do

Neither `theslidemachine.com` nor `wonkledge.com` has one today. Start in
report-only so nothing is rejected while you watch:

```
Name:  _dmarc
Value: v=DMARC1; p=none; rua=mailto:feedback@theslidemachine.com
```

Move to `p=quarantine` and then `p=reject` once the reports show only our own
mail passing.

## 4. Verify DNS before touching the app

Propagation is minutes, not hours, at DigitalOcean's TTLs. Check from a shell:

```sh
dig +short MX theslidemachine.com
dig +short TXT theslidemachine.com          # SPF, alongside the Google one
dig +short TXT dreamhost._domainkey.theslidemachine.com
dig +short TXT _dmarc.theslidemachine.com
```

Then confirm the mailbox itself works, independent of our app: send a message
to `feedback@theslidemachine.com` from an outside address and read it in
DreamHost webmail. If that fails, the problem is DNS or the mailbox — do not go
looking for it in the app.

## 5. Point the app at the new mailbox

Update these on the App Platform app (see [DEPLOY.md](DEPLOY.md) for the full
environment):

| Variable | Value |
| --- | --- |
| `SMTP_HOST` | `smtp.dreamhost.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | `noreply@theslidemachine.com` (the **full address**, not the local part) |
| `SMTP_PASSWORD` | the mailbox password — **secret** |
| `MAIL_FROM` | `noreply@theslidemachine.com` |
| `MAIL_FROM_NAME` | `The Slide Machine` |
| `FEEDBACK_EMAIL` | `feedback@theslidemachine.com` |

`MAIL_FROM` must stay on the same domain as the SPF and DKIM records above.
Sending as one domain while authenticating as another is what breaks
alignment, and it is why the current `@wonkledge.com` sender is worth moving.

**An env change on App Platform requires a redeploy to take effect.** The
running container keeps its old environment until it is replaced, so a
correct password can sit in the spec while every send still fails.

## 6. Confirm delivery, and mean it

`GET /api/config` reports `mailEnabled`, but that flag only checks that
`SMTP_HOST` and a from-address are non-empty — it reads exactly the same
whether the relay accepts our mail or rejects every message. It is not
evidence of delivery.

What is evidence:

```sh
# 202 {"sent":true} means the relay accepted the message; 503 means it refused
curl -s -w '\n%{http_code}\n' -X POST https://theslidemachine.com/api/feedback \
  -H 'Content-Type: application/json' \
  -d '{"kind":"other","subject":"relay check","message":"checking delivery"}'
```

Then read the server log for the authoritative answer, because the two auth
emails deliberately never report failure to the caller — a password reset
answers `204` whether or not a message went out, so that the form cannot be
used to discover who has an account:

```sh
doctl apps logs <app-id> web --type run --tail 50 | grep -iE 'could not send|EAUTH|535'
```

Silence there, plus a `202` above, plus the message in the inbox, is the
three-way check. Any one of them alone is not.

## Where the app sends mail

Four places, all through `server/src/lib/mailer.ts`, so all four break and heal
together:

| Message | Source |
| --- | --- |
| Confirm your email address (AUTH-3) | `server/src/auth/emails.ts` |
| Reset your password (AUTH-4) | `server/src/auth/emails.ts` |
| Feedback form → `FEEDBACK_EMAIL` | `server/src/routes/feedback.ts` |
| Usage cap notices (BILL-8) | `server/src/billing/cap-notifications.ts` |

## Local development

**Set `MAIL_PROVIDER=log` in `server/.env`.** `MAIL_PROVIDER` defaults to
`smtp`, so a local checkout with the `SMTP_*` values filled in will relay real
mail through the production sender — including to test-fixture addresses like
`someone@example.test`, which can never resolve and bounce every time. Bounces
from our own sending domain are what erodes its reputation.

With `MAIL_PROVIDER=log` the whole flow works end to end: the message, link and
all, goes to the server's output, and the link can be pasted into a browser.
`MAIL_LOG_FILE` additionally appends each message to a file, which is how the
e2e suite reads a mailed link back.

## Reference

- [Email client configuration overview](https://help.dreamhost.com/hc/en-us/articles/214918038-Email-client-configuration-overview) — client hostnames and ports
- [Locating your DreamHost email DNS records](https://help.dreamhost.com/hc/en-us/articles/215035818-Locating-your-DreamHost-email-DNS-records) — where the real values live
- [DKIM records](https://help.dreamhost.com/hc/en-us/articles/215029758-DKIM-records) — including the external-DNS case
- [Creating a DMARC policy](https://help.dreamhost.com/hc/en-us/articles/360022808632-Creating-a-DMARC-policy)
