# OAuth consent: three security findings

Status: **all three fixed.** Written 2026-09-19; fixed 2026-09-24 on
`fix/oauth-consent-binding`.

These were found while reviewing the equivalent code in another project
(wikistreets), which had the first of them as a live account-takeover bug.
Slide Machine has the same shape. What shipped:

- **Finding 1.** Both parts. (a): `provider.authorize` sets a
  browser-binding cookie (`sm_oauth_consent`, scoped to `/api/oauth`, not
  `/oauth` — see the fix branch's note below), and `GET`/`approve`/`deny` in
  `routes/oauth.ts` fold the binding check into the same query that already
  refused missing/expired/already-answered requests, so all four refusals stay
  identical (a malformed id's CastError is still caught, too). (b): the `GET`
  now also returns the signed-in account and the redirect URI's host, and
  `OAuthConsentPage.tsx` renders both. The harder variant — the victim's own
  browser starting the flow — is still not something a server-side check can
  refuse; (b) is what a person reading the screen now has to work with.
- **Finding 2.** `exchangeAuthorizationCode` puts the redirect URI and
  resource checks inside the same atomic `findOneAndUpdate` that claims the
  row, so nothing is consumed until every binding matches — a wrong redirect
  URI no longer burns a code. A replay of an already-redeemed code now revokes
  the exact access/refresh tokens that redemption minted (their hashes are
  recorded on the grant at exchange time), with the refusal body kept
  byte-identical to an unknown code's.
- **Finding 3.** `rotateTokens` records the superseded token's hash
  (`previousTokenHash`) on the row that replaces it. Presenting an
  already-rotated-out token is recognised via that link and ends the whole
  connection (`disconnect`), not just the one exchange, and mails the account
  a best-effort notice via the existing mailer — the only visible trace of the
  attempt a user gets.

One deviation from the brief worth recording: the cookie is scoped to
`/api/oauth`, not `/oauth`. The three person-facing consent endpoints answer
under `/api/oauth/authorization/...` (`routes/oauth.ts`, mounted under `/api`
in `app.ts`); `/oauth` is where the machine-facing SDK router lives and never
reads this cookie. A `Path=/oauth` cookie would not have matched the requests
that needed it at all. See `docs/DECISIONS.md` for the rest of the judgment
calls made while fixing this.

The three are ordered by severity. Finding 1 is the one to act on.

---

## 1. HIGH — a parked authorization request can be approved by someone who
did not start it

**Where:** `server/src/routes/oauth.ts`, `POST /oauth/authorization/:id/approve`.

`pendingRequest(id)` loads the row by `_id` alone. The route requires
`requireAuth` — *a* signed-in session — and then stamps `userId: req.userId`
onto the grant. Nothing anywhere ties the request to the browser, session or
user that began the flow, and nothing can: `authorize` in
`oauth/provider.ts` runs before the user is known, which is the whole reason
the request is parked.

So the signed-in user who approves need not be the one the flow was started
for.

**The attack, concretely:**

1. The attacker registers a client at the registration endpoint. Registration
   is unauthenticated by RFC 7591 and by design, and `client_name` is whatever
   they type — `"Claude"`, say. `redirect_uris` is a URL they control. They
   keep the PKCE verifier.
2. They begin the flow themselves. The SDK's authorize handler validates the
   request and `provider.authorize` parks it, redirecting to
   `/oauth/consent?request=<id>`.
3. They send the victim that URL. Or — and this is the variant the wikistreets
   review turned up, which matters here too — they send the victim the
   **authorize URL** instead, so the victim's own browser starts the flow.
   Either works; the second is harder to defend against.
4. The victim is signed in. They see a consent screen naming "Claude" and
   asking for permissions. Everything on the screen is accurate. They approve.
5. `findOneAndUpdate` stamps the grant with **the victim's** `userId`, mints a
   code, and returns `redirectTo` — pointing at the **attacker's** registered
   callback.
6. The attacker holds the verifier, exchanges the code, and has an access and
   refresh token for the victim's account.

**Aggravating detail.** The parked id is a Mongo ObjectId — a timestamp plus a
counter, not a secret — and `CONSENT_REQUEST_TTL_SECONDS` is 15 minutes. That
is a wide window against a partially guessable id. The same id is also
readable by any signed-in user at `GET /oauth/authorization/:id`, which
returns the client name and the requested scopes. That read is low-value on its
own; it is listed here because it shares the missing check.

**Why the consent screen does not save you.** `GET /oauth/authorization/:id`
returns exactly two things: `clientName` and the scopes with their
descriptions. It does not return the redirect URI the code will be delivered
to, and it does not return which account is about to be connected. So there is
nothing on that screen a careful user could use to tell a genuine "Claude"
from this one. The route's own docstring already says the name "is a label and
never a claim" — this is the cost of that being true.

### What to do

Two parts, and the first is necessary but not sufficient.

**(a) Bind the parked request to the browser that started it.** At
`provider.authorize`, set a signed, httpOnly, `SameSite=Lax` cookie carrying a
nonce for that request id, with a lifetime matching
`CONSENT_REQUEST_TTL_SECONDS`. At `/approve` (and at the `GET` read, and at
`/deny`), require that the cookie names this request and matches. No user
identity is needed when the request is parked — only proof that the same
browser is on both ends of it.

Scope the cookie to `/oauth` rather than `/`, so it does not ride on every
request to the origin where a request logger or APM might capture it. Clear it
on a successful approve.

This closes step 3's first variant — an attacker handing over a consent link
they parked themselves. It does **not** close the second variant, where the
victim's browser makes the authorize request, because then the binding passes
honestly.

**(b) Put enough on the consent screen to decide.** This is the only defence
against the second variant; no server-side check can distinguish it from a
legitimate flow, because it *is* a legitimate flow with attacker-chosen
parameters. Three additions, cheap:

- **The registered redirect origin.** "Keys will be sent to
  `attacker.example`" is the single most useful thing that screen can say.
- **Which account is being connected.** A user signed into two accounts, or
  signed in as someone they did not expect, currently has no way to notice.
- **How recently the client registered.** A client created forty seconds ago
  should not look identical to one the user has had connected for a year.
  `client_id_issued_at` is already stored on the client's metadata, so this is
  a render, not a schema change.

Note that (b) is the part that actually addresses the residual risk, and it is
the part most easily dropped as cosmetic. It is not cosmetic.

---

## 2. MEDIUM — a replayed authorization code is refused, and nothing else
happens

**Where:** `server/src/oauth/provider.ts`, `exchangeAuthorizationCode`.

The single-use enforcement is correct: one `findOneAndUpdate` filtered on
`redeemedAt: { $exists: false }`, which is atomic, and the docstring's
reasoning about read-then-write is right.

But a second presentation throws `InvalidGrantError` and stops there. A code
presented twice means the code leaked — the legitimate client already spent it,
so the second caller is someone else. Except it may be the other way round: if
the attacker won the race, they hold working tokens and the *honest* client is
the one now seeing a failure it cannot explain.

Refusing the replay changes nothing for the attacker. The standard's answer is
to revoke everything already issued from that code, on the grounds that a code
used twice is evidence of compromise regardless of who got there first.

**What to do.** Record on the grant which tokens it produced, and on a replay,
delete them — the `disconnect(userId, clientId)` helper in `store.ts` already
does the deletion, though a token-set-level revocation would be tighter. Keep
the refusal body byte-identical to the unknown-code refusal so the difference
is not observable.

**A related ordering bug worth checking while you are in there.** The
wikistreets equivalent stamped `redeemedAt` *before* validating the client,
redirect URI and PKCE verifier, which let anyone holding a code burn it with a
garbage verifier — a repeatable denial-of-connection — and left nothing to
revoke, since the token record did not exist yet. Here the PKCE check happens
inside the SDK's token handler via `challengeForAuthorizationCode`, which reads
the row without consuming it, so the ordering may already be correct. Worth
confirming rather than assuming: the question is whether any path can consume
the row before every binding on it has been checked.

---

## 3. MEDIUM — refresh tokens rotate without reuse detection

**Where:** `server/src/oauth/store.ts`, `rotateTokens`.

`findOneAndDelete` means a refresh token is worth exactly one exchange, which
is right. But a replay of an already-rotated token simply returns `null`, and
the token endpoint answers with an error.

Consider the stolen-token case. The attacker rotates first. The legitimate
client's stored token is now gone, so its next refresh fails; it reports a
connection problem the user cannot diagnose, and the attacker's rotated token
keeps working indefinitely — see below. The signal that a theft occurred is
right there in the failed exchange and is discarded.

**What to do.** Keep one generation of rotation history (the hash of the token
just superseded, on the token record that replaced it). If a superseded token
is presented, end the whole connection for that user and client rather than
refusing one exchange — `disconnect(userId, clientId)` already exists and is
exactly this operation. Tell the user, since a disconnection they did not ask
for is the only visible trace of an attempt.

**Related, and the reason "indefinitely" above is literal.** Check that
`REFRESH_TOKEN_TTL_SECONDS` is genuinely enforced on redemption and not only as
a TTL index. Mongo's reaper runs on a schedule, so an expired row can linger
and still be found. `rotateTokens` does filter on `expiresAt: { $gt: new Date() }`,
which is correct — this is a note to keep it that way, not a finding.

---

## What is already right, so a fix does not undo it

Worth stating, because several of these are the things the wikistreets review
found missing there:

- **Nothing trusts a parameter it did not store.** The redirect URI and scopes
  are re-read from the parked row at approval, never taken from the browser.
  This is the single most important property in the file and it holds.
- **Refusals are uniform.** `pendingRequest` gives the same 404 for missing,
  expired and already-answered. Keep that when adding the binding check: "not
  your request" must answer identically to "no such request". Check the
  malformed-id path too — a `findOne` on a non-ObjectId string can throw a
  CastError and surface as a 500, which distinguishes it from everything else.
- **Two clocks, re-based on approval.** 15 minutes for a person to read the
  screen, a fresh 5 minutes for the code from the moment they click. The
  reasoning in the `CONSENT_REQUEST_TTL_SECONDS` docstring is correct and is
  better than the single-clock design used elsewhere.
- **Secrets are stored as HMACs**, never in the clear, including the client
  secret.
- **Public clients get no secret**, identified by PKCE instead.
- **The endpoints are mounted under a prefix** rather than at the root, after
  the SDK's `/register` collided with the sign-up page. Worth keeping the
  reasoning in the docstring where it is.

---

## Testing notes

Whatever gets fixed, two lessons from the wikistreets review are worth
importing, because both cost it real time:

1. **A test whose header states the threat model will encode that threat
   model.** Its binding test began "the attacker sends the victim
   `/consent?request=<id>`", and the entire suite inherited that assumption —
   which is why the authorize-URL variant went unnoticed until an outside
   reviewer read it.

2. **Verify a guard by deleting the thing it guards.** A redirect-URI check on
   its authorize endpoint had no test at all: removing the line left the whole
   suite green, including a purpose-built coverage guard, because that guard
   matched on test *names* rather than on what the tests touched. For every
   security-relevant branch added here, delete it and confirm something goes
   red. If nothing does, the test is not testing it.
