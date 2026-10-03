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
| B11 | Continue as guest: nothing to set up, it's a Better Auth plugin | Free |
| B11 | An email provider (Resend or Postmark free tier) for verification and password reset | Free tier |
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

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Boot fails naming `BETTER_AUTH_SECRET` | Missing, or shorter than 32 characters |
| Boot fails naming `BETTER_AUTH_URL` | Missing, or not a full URL (`http://localhost:8080`) |
| `/auth/session` returns `null` right after sign-up | curl wasn't given the cookie file (`-b /tmp/lineup.jar`) |
| The browser app can't stay signed in | Expected until B13 sets up cross-origin cookies; test with curl |

---

## Later stages (for reference)

- **B11:**
  - continue as guest: `POST /auth/guest`, which needs no setup
  - upgrade a guest to an email account without losing history
  - an email provider for verification and password reset
- **B13:**
  - the web origin (`http://localhost:3000`, later `https://app.lineup.gg`) is trusted for CORS
  - the cookie is scoped to the parent domain
  - mobile gets bearer tokens
- **B45:** set a new `BETTER_AUTH_SECRET` and the production `BETTER_AUTH_URL` (`https://api.lineup.gg`) on the host.
- **Mobile project:** the `@better-auth/expo` plugin and the app's deep-link scheme.

Social sign-in can be added later. In Better Auth it's a config change plus env keys, with no schema change.
