# Testing → Production: publishing the Google OAuth app

How to move the `slide-machine` Cloud project's OAuth app from **Testing**
(only listed test users) to **In production** (any Google account). Setup of
the client itself is in [GOOGLE_SIGN_IN.md](GOOGLE_SIGN_IN.md); the
connected-account scope and the Picker keys are in
[GOOGLE_API_KEYS.md §6](GOOGLE_API_KEYS.md#6-connected-account-access-forms-drive--slides-exp-4).

> **This is now a short document, and that is the point.** The app requests
> `openid`/`email`/`profile` to sign in and **`drive.file`** to connect a
> Drive — all non-sensitive. Publishing therefore needs no Google review, no
> user cap, and no security assessment. Keep it that way: §5 is the part worth
> reading before anyone adds a scope.

## 1. What the app asks for

| Consent | Scopes | Google's class | Cost to open up |
| --- | --- | --- | --- |
| **Sign-in** ([AUTH-1](SPEC.md#auth-1-registration--sign-in-methods), [google.ts](../server/src/auth/google.ts)) | `openid`, `userinfo.email`, `userinfo.profile` | Non-sensitive | None |
| **Connect** ([EXP-4](SPEC.md#exp-4-connected-accounts-google-drive), [google-connect.ts](../server/src/auth/google-connect.ts)) | `drive.file` | Non-sensitive | None |

`drive.file` is per-file: it reaches what the app created and what the
instructor hands it by picking a file in **Google's Picker**. It cannot list a
Drive, which is why the app has no file browser of its own
([DrivePicker.tsx](../client/src/components/DrivePicker.tsx)).

Take the **Sensitive / Restricted** label the console shows next to a scope as
authoritative — Google reclassifies scopes, and the table above is a snapshot.

## 2. First, check what is actually blocked today

Google exempts authorization requests that ask for **only** the basic identity
scopes from the test-user allowlist, so sign-in may already be open.

**Run the control before planning around it:** on the production deployment,
sign in with a Google account that is **not** on the test-user list and never
has been (borrow a personal Gmail). Then, as that account, try **Connect
Google** in the quiz or export flow.

- Sign-in works, connect does not → only connect is gated, and publishing
  opens it.
- Neither works → the allowlist is gating both; publishing opens both.

An account already on the test-user list proves nothing — it worked before.
The account has to be one the current configuration should reject.

## 3. Pre-flight

### 3.1 Configure the Picker

Live Drive saving and importing need two values that mock mode does not
([GOOGLE_API_KEYS.md §6](GOOGLE_API_KEYS.md#the-google-picker-google_picker_api_key--google_picker_app_id)):

- `GOOGLE_PICKER_API_KEY` — a browser API key restricted to the **Google
  Picker API** and your domain.
- `GOOGLE_PICKER_APP_ID` — the Cloud **project number**.

Enable the **Google Picker API** on the project. Without both set, a live
deployment reports Drive saving and importing as unavailable rather than
opening a chooser that could only come back empty.

### 3.2 A custom domain, for the app's name and logo

Not a blocker for the feature, but a blocker for **brand verification** — the
pass that makes the consent screen show `The Slide Machine` and its logo instead of
a bare URL. Verification requires the homepage, privacy policy and terms to sit
on an **authorized domain**, and an authorized domain must be one whose
ownership you verified in Google Search Console.
`slide-machine-xxxxx.ondigitalocean.app` cannot be: `ondigitalocean.app` is
DigitalOcean's top private domain, not yours.

**Done:** the app is deployed at <https://theslidemachine.com>, which is what
the homepage, `/privacy` and `/terms` must be reached at for verification.
Steps 1–3 below are the record of how; step 4 (Search Console) is the one to
re-check if verification complains about the authorized domain.

1. Register a domain and attach it — DO dashboard → app → **Settings →
   Domains** ([DEPLOY.md §6](DEPLOY.md#6-register-the-google-oauth-redirect-uri)).
2. Set `PUBLIC_BASE_URL` to `https://<domain>` and redeploy.
3. Add `https://<domain>/api/auth/google/callback` to the OAuth client's
   **Authorized redirect URIs**, and `https://<domain>` to **Authorized
   JavaScript origins**. Byte-for-byte, or you get `redirect_uri_mismatch`.
4. Verify the domain at <https://search.google.com/search-console> as a
   **Domain property** (DNS TXT record), signed in as the Google account that
   owns the Cloud project. A "URL prefix" property is not accepted.

### 3.3 The public pages

The homepage, `/privacy` and `/terms` must be publicly reachable without
logging in (they are — see [App.tsx](../client/src/App.tsx)), on the domain
above, and linked from the consent screen.

Google rejected a first verification attempt on the **homepage** requirements,
which are stricter than "the page loads signed out". A homepage that is a
tagline and a sign-in button fails two of them. What the page has to do is
[AUTH-7](SPEC.md#auth-7-public-homepage--consent-disclosures), and it now does:

| Google's requirement | Where it is met |
| --- | --- |
| Accurately represent and identify the app or brand | Hero on [LandingPage.tsx](../client/src/pages/LandingPage.tsx) — the mark and the name **The Slide Machine**, which is also what the console's Branding tab must say |
| Fully describe the app's functionality | The "What it does" section — the live loop plus four feature cards |
| Explain with transparency the purpose for which the app requests user data | The "What we ask for, and why" section — the account fields, what Google sign-in receives, what `drive.file` does and does not reach, and what happens to microphone audio |
| Hosted on a verified domain you own | <https://theslidemachine.com> (§3.2) |
| Link to the privacy policy, matching the consent screen | [SiteFooter.tsx](../client/src/components/layout/SiteFooter.tsx) on every page, plus an inline link in the data section and in the notice under both auth forms. Set the consent screen's link to `https://theslidemachine.com/privacy` **byte for byte** |
| Visible without logging in | The whole page; signed-in visitors are redirected to `/app` instead |

The brand name is **The Slide Machine**, in the app and in the console. A
console that says `Slide Machine` and a homepage that says something else is
the first requirement failing.

- Fill `OPERATOR_NAME`, `OPERATOR_JURISDICTION`, `OPERATOR_CONTACT_EMAIL`,
  `OPERATOR_POSTAL_ADDRESS` ([DEPLOY.md §5](DEPLOY.md#5-environment-variables)).
  Left blank, the live page shows `[Operator legal name]`.
- The privacy policy should disclose how the app accesses, uses, stores and
  shares Google user data. The wording lives in
  [client/src/content/](../client/src/content/).
- Decide what to do about the **draft banner** both pages carry until a lawyer
  has read them. Shipping it to a reviewer is a risk; removing it before
  review is a legal decision, not a docs one.

### 3.4 Branding and scopes in the console

Cloud Console → **Google Auth Platform** (this is where "APIs & Services →
OAuth consent screen" moved during 2025; the tabs are **Branding / Audience /
Clients / Data Access / Verification Center**).

- **Branding** — app name `The Slide Machine`, logo, support email, app home page,
  privacy policy and terms links, and the authorized domain from §3.2.
- **Data Access** — the declared scopes must match what the code requests, no
  more: the four in the §1 table. A scope declared but unused is a rejection
  risk; a scope used but undeclared fails at consent time.

## 4. Publish

1. **Google Auth Platform → Audience.**
2. Under **Publishing status: Testing**, click **Publish app**.
3. Confirm. Status becomes **In production**.

The **test users** list stays where it is — it simply stops gating access, and
starts gating again if you ever go **Back to testing**. Leave the entries.

What is true the moment you publish, on the current scope set:

- Any Google account can sign in and connect.
- Refresh tokens stop expiring after 7 days.
- **No** user cap and **no** "Google hasn't verified this app" danger screen —
  those apply to sensitive and restricted scopes, and the app requests none.
- The consent screen shows a bare URL rather than the app name and logo until
  brand verification (§5) completes.

## 5. Brand verification, and keeping it cheap

Start it from **Google Auth Platform → Verification Center**. On this scope set
it is only the brand pass — app name, logo, domain — typically 2–3 business
days. There is no scope justification, no demo video, and no security
assessment, because there is nothing sensitive or restricted to justify.

**That is a property of the scope list, not of the app.** It survives only
while the list stays as it is. Before adding any scope:

1. Check whether `drive.file` already covers the call. For every Google method
   this app uses, it does — `forms.create`, `forms.batchUpdate`, `forms.get`,
   `presentations.get`, and the Drive reads and writes all accept it.
2. If it genuinely does not, read the label the console shows against the new
   scope:
   - **Sensitive** → a verification review: scope justifications, a demo video
     showing the OAuth grant and each scope's feature, and days to weeks of
     queue. Compliant results are valid for **7 days** — publish inside that
     window or the status flips to *Need to re-verify*.
   - **Restricted** (`drive.readonly`, `drive`, and the rest of the Drive
     family) → all of the above **plus** a paid third-party **CASA** security
     assessment, redone every 12 months or the scope is withdrawn.

The app carried `forms.body`, `forms.body.readonly` and `drive.readonly` until
the Picker migration. They bought one thing between them — `files.list`, so the
app could draw its own Drive browser — and cost a recurring annual audit. That
is the trade to weigh against any future scope.

## 6. Confirm it actually took effect

Publishing changes nothing you can see from an account that already worked, so
neither can it be evidence.

| Check | Passes only if publishing happened |
| --- | --- |
| Sign in with a Google account never added as a test user | Yes — it was rejected before |
| Connect Drive from that same account, and pick a file | Yes |
| Existing test users still sign in | **No** — identical before and after |
| Console shows *In production* | Only that the button was clicked |
| A connected account's refresh token still works on day 8+ | Yes — Testing capped it at 7 days |

The last one is the only proof that offline access is fixed, and it takes a
week to collect. Note the date you publish and check a real connection later
rather than assuming.

Two Picker-specific checks belong in the same pass, because both fail in ways
that look like success from the browser:

- **Pick a file, then let the server read it.** Import a presentation end to
  end. A wrong `GOOGLE_PICKER_APP_ID` gives a pick that appears to work and a
  server-side read that 404s.
- **Pick something under "Shared with me"** — a deck a colleague shared that
  the instructor never added to their own Drive. It is the case the old
  paste-a-link flow covered and the one a picker configuration can quietly
  drop.

## 7. Rolling back

**Audience → Back to testing.** Non-test users can no longer consent, the
test-user list gates access again, and newly issued refresh tokens go back to
expiring in 7 days. Grants already issued are not revoked, but treat any
production grant as unreliable after a rollback.

## 8. What does not change

- **No new OAuth client**, no `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` change, no
  secret rotation.
- **No new redirect URI** beyond adding the custom domain (§3.2) — connect
  reuses the sign-in callback deliberately.
- **No `CONNECTED_ACCOUNT_TOKEN_ENC_KEY` change.** Rotating it orphans every
  existing connection.

## References

- [OAuth app states overview](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)
- [Brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
- [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) — what the app avoids
- [Choose Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Picker overview](https://developers.google.com/workspace/drive/picker/guides/overview)
- [Manage app audience](https://support.google.com/cloud/answer/15549945)
- [Domain verification](https://support.google.com/cloud/answer/13804266)
