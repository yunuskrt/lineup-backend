# Phase B11b — Email Verification

## Status

Complete

## Goals

- `src/config/env.schema.ts`, each new key also added to `.env.example`:
  - `WEB_APP_URL`: required, the web app's origin (`http://localhost:3000` in dev). The verification link sends the player back there.
  - `MAIL_FROM`: required, the sender address (`Lineup <onboarding@resend.dev>` until a domain is verified)
  - `RESEND_API_KEY`: optional in development and test, **required when `NODE_ENV` is `production`** (Open Questions 1)
- `src/mail/`:
  - `mailer.ts`: a `Mailer` interface, `send({ to, subject, text, html })`, and a `MAILER` injection token
  - `resend.mailer.ts`: posts to Resend's HTTP API with `fetch`. No SDK dependency.
  - `log.mailer.ts`: for development without a key. Logs that a verification mail was sent, plus the link, which is the only way to click it locally. No address in the log.
  - `mail.module.ts`: chooses Resend when `RESEND_API_KEY` is set, the log mailer otherwise, and logs which one at boot
- `src/auth/auth.factory.ts`, given the `Mailer`:
  - `emailVerification`:
    - `sendOnSignUp: true`
    - `sendVerificationEmail` builds a plain message (one link, no tracking) and sends it through the `Mailer`
    - `expiresIn`: 24 hours (Better Auth's default is 1 hour)
    - `autoSignInAfterVerification: false`. The player is already signed in from sign-up.
  - `emailAndPassword.requireEmailVerification` stays `false` (Open Questions 2)
  - `trustedOrigins: [WEB_APP_URL]`, so `/api/auth/verify-email` accepts the web's callback URL
- `src/auth/auth-flow.service.ts`:
  - sign-up passes `callbackURL: ${WEB_APP_URL}/profile` to `signUpEmail`
  - after a successful upgrade (B11a), calls `auth.api.sendVerificationEmail` with the same callback
- **`emailVerified` in the contract `User`** (Open Questions 3), an additive REST change:
  - `src/contract/auth.ts`: `userSchema` gains `emailVerified: boolean`, so OpenAPI's `User`, `Session` and `SessionOrNull` carry it
  - `toContractUser` reads it from `users.email_verified`, never from the request. A guest is always `false`.
  - every place that builds or expects a contract `User` (contract fixtures, unit specs, the auth and guest e2e suites) includes it
  - no socket payload embeds `User`, so `PROTOCOL_VERSION` stays 1
- The native `GET /api/auth/verify-email` stays switched on. It's the link's target: it sets `email_verified`, then redirects to the callback, adding `?error=…` when the token is bad or expired.
- `context/docs/auth-setup.md` § **Email Verification**: the step-by-step setup and test guide, already written at spec time. Each step names the stage it's needed at. **Keep it true to what's built:** any change to env keys, the provider, the link, the redirect or the expected results updates that section in the same turn.
- Tests:
  - `src/mail/resend.mailer.spec.ts` (unit, `fetch` mocked): the request shape, and a non-2xx answer throws without echoing Resend's body
  - `src/config/parse-env.spec.ts`: the new keys, and `RESEND_API_KEY` required only in production
  - `src/auth/auth.factory.spec.ts`: verification settings, `trustedOrigins`, guests never mailed, a mailer failure swallowed
  - `test/auth/email-verification.e2e-spec.ts`, with a capturing `Mailer` swapped in:
    - sign-up sends exactly one mail to the new address, holding a `/api/auth/verify-email` link
    - following the link sets `email_verified` and redirects to `WEB_APP_URL/profile`
    - a tampered token redirects with an error and leaves `email_verified` false
    - `POST /auth/guest` sends nothing
    - an upgrade sends one mail to the new address
    - a mailer that throws doesn't fail sign-up: the `Session` still comes back
    - `GET /auth/session` reads `emailVerified: false` after sign-up and `true` after the link is followed

## Open Questions

Settled at `/feature load`: 1 and 2 as recommended; 3 the other way, so `emailVerified` is added now (see Goals).

1. **Which mail provider?** The spec names none. **Recommended: Resend.**
   - one HTTP call with an API key, so no SDK and no SMTP connection to manage
   - its free tier covers MVP sign-ups
   - without a verified domain it can still send from `onboarding@resend.dev` to your own address, so B11b can be tested for real before any DNS work
   - fits Hard Constraint 14: no extra infrastructure
   - the `Mailer` interface keeps a later swap to one file

   The alternative is SMTP through `nodemailer`, which works with any host but adds a dependency and a connection to keep alive. If it's chosen, rewrite the guide's Resend steps.
2. **Does an unverified email block anything?** **Recommended: no, verification is soft at MVP.**
   - The contract has no "check your inbox" state. Sign-up and upgrade return a `Session` right away, and `requireEmailVerification` would break both.
   - Guest play is first-class and has no email at all, so blocking unverified accounts would be stricter than blocking no one.
   - A verified address matters once password reset exists. That phase can require it.
3. **Is `emailVerified` added to the contract `User`?** The web can't show "verify your email" without it. **Recommended: not in B11b.** It's an additive contract change for W28 to pick up, and nothing in the current web screens reads it. Record the decision either way.

   **Decided: add it now.** The backend owns the contract, and the change is additive: a field is added, none is removed or renamed.

## Out of Scope

- Password reset and email change. Both need verified email first, and neither is in the contract.
- A "resend verification email" endpoint. It's not in the contract; adding one is a contract change.
- Verifying a sending domain in Resend. It needs a domain and DNS access, and is only required before real players sign up (B45). The guide lists it as a later step.
- HTML templates beyond one plain message, and localisation.
- Rate limiting verification sends: B35.
- Moving `WEB_APP_URL` into credentialed CORS and the origin check: B13 reuses the key.

## Notes

- Scope: sending a verification mail on sign-up and on upgrade, and the native link that confirms it. Nothing is blocked by an unverified address.
- Depends on: B11a. The upgrade flow is where the second send hooks in, and guests' `.invalid` emails are what make "never mail a guest" safe.
- **Better Auth awaits `sendVerificationEmail` inside sign-up.** No background task runner is configured, so a throw there fails the request after the user row exists. The callback must catch, log only the error code, and return.
- **Guests are never mailed.** Their `@guest.lineup.invalid` address can't receive mail, but check `isAnonymous` anyway before sending, rather than relying on the TLD alone.
- **The verification token is a signed JWT,** not a row in `auth_verifications`. It's signed with `BETTER_AUTH_SECRET`, so rotating the secret invalidates every link in flight.
- **Without a `callbackURL`,** Better Auth redirects to `/` on the backend, which is an enveloped 404. Every send must pass the web callback.
- Constraints:
  - no email address, token or Resend response body in any log or error message. The log mailer's link is development only.
  - `RESEND_API_KEY` is a secret: validated at boot, never logged
  - `src/mail/` holds no auth logic, and `src/auth/` holds no HTTP mail calls
  - no `any`; `@/` imports; comments single-line, at most 50 characters
- Verification:
  - `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`
  - **A real send, by following `auth-setup.md` § Email Verification end to end:** sign up with your Resend account's address, receive the mail, open the link, see the redirect, and see `email_verified` set. Then the same for a guest upgrade. Required before `/todo done`.
  - The log mailer path once as well, with `RESEND_API_KEY` unset
  - The e2e file owns its prefixes (`test-mail-` emails, `test-m-` handles) and deletes its own users

**Deviations recorded during implementation**

- **The send is fire-and-forget, not awaited and caught.** `sendVerification` (exported from `src/auth/auth.factory.ts`) starts `mailer.send` and returns at once; a failure is caught and logged. Sign-up never waits on Resend, and a slow provider can't delay it. `ResendMailer` gives up after 10 s.
- **The message lives in `src/auth/verification-email.ts`:** subject "Confirm your Lineup email", a text part with the raw link, and an HTML part with the link escaped. No address in the body. It sits in `src/auth/` because its wording is auth logic; `src/mail/` only delivers.
- **Env rules, tighter than the spec's:**
  - `WEB_APP_URL` is normalised to its origin, so a trailing slash can't produce `//profile`.
  - `MAIL_FROM` must be `Name <address>` or a bare address.
  - `RESEND_API_KEY` must start with `re_`, so an empty or mistyped key fails boot.
  - The production check runs with `when: () => true`, so a missing key is reported alongside any other bad key.
- **`AuthFlowService` injects `ENV`** to build the callback, `${WEB_APP_URL}/profile`.
- **Upgrade send:** after the fresh session, the service calls `auth.api.sendVerificationEmail` with the new address and the callback. A failure is logged with Better Auth's code only, and never undoes the upgrade.
- **`emailVerified`:** `toContractUser` returns `false` for a guest whatever the stored flag says. `asAuthUser` carries the flag through.
- **The log mailer logs the subject and the mail's text,** which holds the link. It never logs the recipient.
- **Found while testing: e2e runs would have mailed for real.** Every e2e suite boots the app from `.env`, which now holds a real `RESEND_API_KEY`, so each test sign-up would have called Resend for an `@lineup.test` address. `test/vitest.e2e.setup.ts` now deletes the key, so every suite gets the log mailer; the verification suite swaps in a capturing mailer. Nest's testing logger hides `log` and `warn`, so the choice was confirmed with a one-off script (`e2eMailer: 'LogMailer'` with the key in `.env`).
- **Docs:**
  - `auth-setup.md` § Email Verification now gives the exact boot and send log lines, the subject, the `emailVerified` checks over `GET /auth/session`, the `re_` rule, and an `EADDRINUSE` troubleshooting row.
  - `guest-upgrade-testing.md` expects `emailVerified` in the responses.
- **Tests:** 276 unit (38 new) and 228 e2e (6 new) at the end of `/feature start`; see Review fixes for the final totals.
  - `parse-env.spec.ts`: the new keys, origin normalising, sender formats, `re_` keys, production-only requirement, no echo of a bad key
  - `auth-flow.service.spec.ts`: `emailVerified` mapping (guest never verified), the sign-up callback, the upgrade send, a failed send that doesn't undo the upgrade and logs no address, no send on a refused upgrade
  - `auth.factory.spec.ts`: verification settings, `trustedOrigins`, the mail built from the link, guests never mailed, a failed send swallowed without an address, the send not awaited
  - `verification-email.spec.ts`, `resend.mailer.spec.ts`, `mail.module.spec.ts`: the message, the Resend request and refusal, the mailer choice, the log mailer never logging the address or key
  - `contract/auth.spec.ts`: `emailVerified` required and boolean
  - `test/auth/email-verification.e2e-spec.ts`, 6 cases: one mail on sign-up, the link verifies and redirects to `WEB_APP_URL/profile` and the session reads `true`, a tampered link redirects with `error=` and leaves it `false`, no mail for a guest, one mail after an upgrade (lowercased) whose link verifies, a failing mailer doesn't fail sign-up
- **Checked by hand on the built server, log mailer:** sign-up → logged link → 302 to `http://localhost:3000/profile` → session `emailVerified: true`; guest → no mail; upgrade → one mail → verified. No address in the log.
  - It ran on port 8081, because a dev server started before B11b held 8080. One sign-up reached that old server by mistake; it sent nothing, and the user it created was deleted. Both test users were deleted afterwards.
- **Real Resend send (at `/todo done`):** Step 7, a real sign-up, passed: the mail arrived and the link verified the address. Step 8, the guest upgrade, was **not run for real**. B11 was ticked anyway at the developer's decision. The upgrade send is covered by the e2e suite and the log-mailer run on the built server, and it uses the same mailer as Step 7.
- **Review fixes:**
  - **Native send route closed.** Configuring a sender made Better Auth's core `POST /api/auth/send-verification-email` live over HTTP. Anyone could make the server mail any registered, unverified address, with no rate limit before B35: a spam vector, a drain on the Resend quota, and a "resend" endpoint the spec puts out of scope. It's now in `disabledPaths`. The upgrade's send uses the server API, which `disabledPaths` doesn't block. An e2e case pins the 404 and checks no mail goes out.
  - **The origin check now runs under test too.** Better Auth sets `skipOriginCheck` whenever it detects a test environment, so the e2e suite never checked the link's `callbackURL` against `trustedOrigins`. A probe showed a swapped `callbackURL` redirecting to `https://evil.example` under test. Development and production were already protected (403). `advanced.disableOriginCheck: false` is now set explicitly, so tests behave like production. An e2e case pins the 403, and no other suite was affected.
  - Two comments shortened to the 50-character limit.
  - **Totals:** 277 unit and 230 e2e. The verification suite now has 8 cases.
- **Added at `/feature test`:** 2 unit cases, both privacy guards on failed sends:
  - `auth.factory.spec.ts`: a mailer that rejects with something other than an `Error` logs `unknown error`, never the rejected value
  - `auth-flow.service.spec.ts`: an upgrade send that fails with a plain `Error` logs only `error`, never that error's message

  **Coverage from unit tests:**
  - 100% lines, branches and functions: `auth.factory.ts`, `verification-email.ts`, `env.schema.ts`, `contract/auth.ts`, and all four `src/mail/` files
  - `auth-flow.service.ts`: 100% branches, 97% lines. The 3 uncovered lines are catch blocks from B10b and B11a that go through the already-tested `fromBetterAuth`.
  - The controller and the modules are wiring, covered only by the e2e suite, per the standards.

  **Totals:** 279 unit and 230 e2e.
- **Observations left for later phases:**
  - **An upgrade takes at least 500 ms longer.** With no session on the call, Better Auth's send route pads every response to a 500 ms floor, so you can't tell from timing whether an address is registered. Passing the fresh session cookie would skip the floor; it's left as is because an upgrade happens once per player.
  - **No resend path exists.** A player who loses the mail can't ask for another until a resend endpoint is added to the contract.

## History
