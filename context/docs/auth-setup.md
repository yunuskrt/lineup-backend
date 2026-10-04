# Auth Setup — Better Auth

What to set up for authentication, and when, so that sign-in can be tested end to end once B10 is built.

Sign-in methods: **email + password** and **continue as guest**. There is no social sign-in (Google, Apple), so no third-party account is needed.

---

## At a glance

| When | What | Cost |
| --- | --- | --- |
| **Before B10a** | Step 1: Better Auth secret and URL in `.env` | Free |
| **After B10a** | Step 2: check the new tables in Neon | — |
| **After B10b** | Step 3: test email sign-up and sign-in | — |
| B11a | Continue as guest: nothing to set up, it's a Better Auth plugin | Free |
| **Before B11b** | [Email Verification](#email-verification) Steps 4–5: Resend account, API key, `.env` keys | Free tier |
| **After B11b** | [Email Verification](#email-verification) Steps 6–8: test the verification mail | — |
| Before B45 | [Email Verification](#email-verification) Step 9: verify a sending domain | Free tier |
| B13 | Web origin and cookie domain | — |
| B45 | Production secret and URL on the host | — |

Better Auth needs no account. It's a library that runs inside the backend and writes to your Neon database.

---

## Step 1 — Secret and URL (before B10a)

1. Generate a secret:

   ```bash
   openssl rand -base64 32
   ```

2. Add to `.env`:

   ```bash
   BETTER_AUTH_SECRET="<the output above>"
   BETTER_AUTH_URL="http://localhost:8080"
   ```

- The secret signs session cookies. Never commit it, and use a different one in production.
- `BETTER_AUTH_URL` is the backend's own address.
- The server refuses to boot if either is missing, or if the secret is shorter than 32 characters.

---

## Step 2 — Check the database (after B10a)

1. B10a's migration runs on your Neon dev branch during `/feature start`. To apply it yourself:

   ```bash
   npm run db:migrate
   npm run db:status   # "Database schema is up to date"
   ```

2. Look at the new tables, either with `npm run db:studio` or in the Neon console under **Tables**:

   | Table | Holds |
   | --- | --- |
   | `users` | One row per player: id, email, handle |
   | `auth_accounts` | The hashed password (one `credential` row per user) |
   | `auth_sessions` | One row per signed-in device |
   | `auth_verifications` | Short-lived tokens (used from B11) |

3. Start the server with `npm run start:dev`, then open http://localhost:8080/api/auth/ok. It should show `{ "ok": true }`.

---

## Step 3 — Test sign-in (after B10b)

Keep `npm run start:dev` running.

```bash
# Sign up; saves the session cookie to a file
curl -i -c /tmp/lineup.jar -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"correct-horse","handle":"yunus"}' \
  http://localhost:8080/auth/sign-up

# Read the session back
curl -b /tmp/lineup.jar http://localhost:8080/auth/session

# Sign out; the session is now null
curl -b /tmp/lineup.jar -c /tmp/lineup.jar -X POST http://localhost:8080/auth/sign-out
curl -b /tmp/lineup.jar http://localhost:8080/auth/session

# Sign in again
curl -c /tmp/lineup.jar -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"correct-horse"}' \
  http://localhost:8080/auth/sign-in
```

**What to expect:**

- Success: `{ "success": true, "data": { "user": { "id", "handle", "isGuest": false, "tier": "free" } } }`
- Wrong password: `{ "success": false, "error": { "code": "unauthorized", … } }`
- Taken handle or email: `invalid_input`
- In Neon:
  - one new row in `users` and one in `auth_accounts`
  - a row in `auth_sessions` while you're signed in, deleted when you sign out
  - the password column holds a hash, never your password

You can also run these calls from the Swagger UI at http://localhost:8080/docs.

**Clean up:** delete your test user in Prisma Studio. Its sessions and accounts are deleted with it.

---

## Email Verification

From B11b, every email sign-up and every guest upgrade sends one mail with a confirmation link. Opening the link marks the address as verified and sends the player to the web app's `/profile`.

- **Nothing is blocked by an unverified address.** Players can play straight after sign-up; verification only records that the address is real.
- **Guests are never mailed.** They have no real address.
- Mail goes through **Resend**. Without an API key, the server uses a **log mailer** instead: it prints the link in the server log rather than sending anything.

### When each step is needed

| Stage | Step | Why |
| --- | --- | --- |
| **Before B11b `/feature start`** | Step 4: Resend account and API key | The real-send test. The server runs without it, using the log mailer. |
| **Before B11b `/feature start`** | Step 5: new `.env` keys | Once B11b's code is in, the server and the e2e suite won't boot without `WEB_APP_URL` and `MAIL_FROM` |
| **After B11b** | Step 6: test with the log mailer | Proves the link works with no provider at all |
| **After B11b** | Step 7: test a real send on sign-up | Required before `/todo done` for B11b |
| **After B11b** (B11a must be done) | Step 8: test a real send on guest upgrade | Required before `/todo done` for B11b |
| Before B45, or before real players sign up | Step 9: verify a sending domain | Without it, Resend only delivers to your own address |

### Step 4 — Resend account and API key (before B11b)

1. Sign up at https://resend.com/signup. **Use an address you can read:** until a domain is verified (Step 9), Resend only delivers to the address your account was created with.
2. In the dashboard, open **API Keys** → **Create API Key**:
   - Name: `lineup-dev`
   - Permission: **Sending access**
   - Domain: **All domains**
3. Copy the key. It starts with `re_` and is shown **only once**. If you lose it, delete it and create a new one.

The free tier is enough for development; check Resend's pricing page for the current daily and monthly limits.

### Step 5 — `.env` keys (before B11b)

Add to `.env`:

```bash
WEB_APP_URL="http://localhost:3000"
MAIL_FROM="Lineup <onboarding@resend.dev>"
RESEND_API_KEY="re_…"
```

- `WEB_APP_URL` is where the link sends the player after confirming. The web app doesn't have to be running for verification to work.
- `MAIL_FROM` must stay `onboarding@resend.dev` until Step 9. Resend refuses any other sender on an unverified domain.
- **To use the log mailer, delete the `RESEND_API_KEY` line or comment it out.** Don't leave it as an empty string: the key must start with `re_`, so an empty or mistyped key stops the server at boot.
- `RESEND_API_KEY` is a secret: never commit it. In production it's required, and the server refuses to boot without it.
- On boot, the server log says which mailer it chose: `Sending mail through Resend`, or `WARN [Mail] No RESEND_API_KEY: mail goes to the log`.
- **The e2e suite never sends real mail.** It ignores `RESEND_API_KEY`, even when `.env` has one.
- **Stop any other server on port 8080 first.** A server started before B11b keeps running the old code, and a second one fails with `EADDRINUSE`.

### Step 6 — Test with the log mailer (after B11b)

1. Comment out `RESEND_API_KEY`, then start `npm run start:dev`.
2. Sign up with any address:

   ```bash
   curl -c /tmp/lineup.jar -H 'content-type: application/json' \
     -d '{"email":"me@example.com","password":"correct-horse","handle":"logtest"}' \
     http://localhost:8080/auth/sign-up
   ```

3. Find the verification link in the server log, under `LOG [Mail] Not sent (no RESEND_API_KEY): "Confirm your Lineup email"`. It looks like `http://localhost:8080/api/auth/verify-email?token=…&callbackURL=http%3A%2F%2Flocalhost%3A3000%2Fprofile`. The log shows the mail's text but never the address.
4. Open it with curl, to see the redirect:

   ```bash
   curl -i '<the link>'
   ```

**What to expect:**

- `302`, with `Location: http://localhost:3000/profile`
- The sign-up response had `"emailVerified": false`. Now `curl -b /tmp/lineup.jar http://localhost:8080/auth/session` shows `"emailVerified": true`.
- In Prisma Studio (`npm run db:studio`), the user's `email_verified` is now `true`
- **Clean up:** delete the user in Prisma Studio

### Step 7 — Test a real send on sign-up (after B11b)

1. Put `RESEND_API_KEY` back, and restart the server. The boot log should name Resend.
2. Sign up with **your Resend account's address**:

   ```bash
   curl -c /tmp/lineup.jar -H 'content-type: application/json' \
     -d '{"email":"<your Resend address>","password":"correct-horse","handle":"mailtest"}' \
     http://localhost:8080/auth/sign-up
   ```

3. The sign-up answers with a `Session` straight away, with `"emailVerified": false`. Within a minute, a mail from `onboarding@resend.dev` with the subject **Confirm your Lineup email** arrives. Check spam if it doesn't.
4. Click the link in the mail.

**What to expect:**

- The browser goes to `http://localhost:3000/profile`. If the web app isn't running, the browser shows "can't connect", which is fine: the address was verified before the redirect.
- `curl -b /tmp/lineup.jar http://localhost:8080/auth/session` shows `"emailVerified": true`, and `email_verified` is `true` in Prisma Studio
- In Resend's dashboard under **Emails**, the mail shows as **Delivered**
- **A broken link:** copy the link, change one character of the token, and open it. It redirects to `/profile` with an `error=` parameter (for example `INVALID_TOKEN`), and `email_verified` doesn't change.
- **Clean up:** delete the user in Prisma Studio. Step 8 needs the same address free again.

### Step 8 — Test a real send on guest upgrade (after B11b)

```bash
# Start as a guest; no mail is sent
curl -c /tmp/lineup.jar -X POST http://localhost:8080/auth/guest

# Upgrade the guest with your Resend address
curl -b /tmp/lineup.jar -c /tmp/lineup.jar -H 'content-type: application/json' \
  -d '{"email":"<your Resend address>","password":"correct-horse","handle":"upgradetest"}' \
  http://localhost:8080/auth/upgrade
```

**What to expect:**

- `POST /auth/guest` returns `isGuest: true`, and nothing new appears under **Emails** in Resend
- The upgrade returns the **same user id** with `isGuest: false`
- One verification mail arrives. Its link sets `email_verified` to `true`, exactly as in Step 7.
- **Clean up:** delete the user in Prisma Studio

### Step 9 — Verify a sending domain (before B45)

Needed before real players sign up: until then, mail to anyone but you is refused.

1. In Resend, open **Domains** → **Add Domain** and enter the domain to send from (for example `lineup.gg`).
2. Add the DNS records Resend lists (DKIM and SPF) at your DNS provider, then press **Verify**. DNS changes can take from minutes to a few hours.
3. Once the domain shows **Verified**, change the sender:

   ```bash
   MAIL_FROM="Lineup <no-reply@lineup.gg>"
   ```

4. Create a separate API key for production, limited to that domain, and set it on the host at B45. Never reuse the dev key.

---

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Boot fails naming `BETTER_AUTH_SECRET` | Missing, or shorter than 32 characters |
| Boot fails naming `BETTER_AUTH_URL` | Missing, or not a full URL (`http://localhost:8080`) |
| `/auth/session` returns `null` right after sign-up | curl wasn't given the cookie file (`-b /tmp/lineup.jar`) |
| The browser app can't stay signed in | Expected until B13 sets up cross-origin cookies; test with curl |
| Boot fails naming `WEB_APP_URL` or `MAIL_FROM` | Missing from `.env` (Step 5) |
| Boot fails naming `RESEND_API_KEY` | `NODE_ENV=production` without a key, or a key that doesn't start with `re_` (an empty string included). Comment the line out instead. |
| Sign-up works but no mail arrives | Signed up with an address other than your Resend account's (Step 4). Check **Emails** in Resend, and the server log for a refused send. |
| The server log shows `Verification mail not sent: Resend refused the mail with 403` | Sent to an address other than your Resend account's, or a `MAIL_FROM` other than `onboarding@resend.dev` before Step 9 |
| The server log shows `Verification mail not sent: Resend refused the mail with 401` | A wrong or deleted API key |
| Boot fails with `EADDRINUSE` | Another server, maybe started before B11b, is already on port 8080. Stop it first. |
| The link redirects with `error=TOKEN_EXPIRED` | Older than 24 hours. Delete the user and sign up again. |
| The link redirects with `error=INVALID_TOKEN` | The link was cut short when copied, or `BETTER_AUTH_SECRET` changed after it was sent |

---

## Later stages (for reference)

- **B11a:**
  - continue as guest: `POST /auth/guest`, which needs no setup
  - upgrade a guest to an email account without losing history (`POST /auth/upgrade`, same user id)
- **B11b:** email verification, set up and tested per [Email Verification](#email-verification). Password reset comes in a later phase.
- **B13:**
  - the web origin (`http://localhost:3000`, later `https://app.lineup.gg`) is trusted for CORS
  - the cookie is scoped to the parent domain
  - mobile gets bearer tokens
- **B45:** set a new `BETTER_AUTH_SECRET` and the production `BETTER_AUTH_URL` (`https://api.lineup.gg`) on the host.
- **Mobile project:** the `@better-auth/expo` plugin and the app's deep-link scheme.

Social sign-in can be added later. In Better Auth it's a config change plus env keys, with no schema change.
