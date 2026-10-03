# Phase B11b — Email Verification

## Status

Not Started

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

## Open Questions

Settle these at `/feature load`.

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
- **The web route `/profile` doesn't read `?error=` yet.** Note it for W28 alongside Open Questions 3.
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

## History
