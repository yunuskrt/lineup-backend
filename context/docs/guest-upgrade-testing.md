# Guest & Upgrade Testing

How to test continue as guest and guest → account upgrade by hand, with curl and SQL, once B11a is built.

There's nothing to set up: guests come from Better Auth's anonymous plugin, which runs inside the backend. You need the B10 setup from `auth-setup.md` (Steps 1–2) and B11a's migration applied (`npm run db:status` → "Database schema is up to date").

---

## At a glance

| Step | What it proves |
| --- | --- |
| 1 | A guest is created with a generated handle and a cookie, and a second call returns the same guest |
| 2 | (Optional) The guest has game history to carry over |
| 3 | Upgrade keeps the user id and the history, and the old guest cookie stops working |
| 4 | The new email and password sign in to the same user |
| 5 | Every refusal returns the right code, and a refused guest stays a guest |
| 6 | A guest signing in to a different account leaves the guest row in place |
| 7 | Better Auth's native guest routes are closed |

---

## Before you start

1. Start the server with `npm run start:dev`, and run the commands below in another terminal.
2. curl saves the session cookie to a file (`-c`) and sends it back (`-b`), as a browser would. Each file stands for one device.
3. For the SQL, use the Neon console's **SQL Editor**, or browse the tables with `npm run db:studio`.

The examples use `upgrade-test@example.com` and handle `upgradetest`. Step 5 also uses `yunus`, the account from `auth-setup.md` Step 3; use your own handle if it's different.

---

## Step 1 — Continue as guest

```bash
# Create a guest; saves its cookie
curl -s -c /tmp/guest.jar -X POST http://localhost:8080/auth/guest

# Read the session back
curl -s -b /tmp/guest.jar http://localhost:8080/auth/session

# Call it again with the same cookie: same id, no second guest
curl -s -b /tmp/guest.jar -c /tmp/guest.jar -X POST http://localhost:8080/auth/guest
```

**What to expect:**

- `{ "success": true, "data": { "user": { "id", "handle": "guest-…", "isGuest": true, "tier": "free" } } }`
- The handle is `guest-` plus 8 lowercase letters and digits, for example `guest-cd5n64p0`
- The same `id` all three times

Copy the `id`; the steps below call it `<GUEST_ID>`.

**In the database:**

```sql
SELECT id, handle, name, email, is_anonymous, email_verified FROM users WHERE is_anonymous;
SELECT count(*) FROM auth_accounts WHERE user_id = '<GUEST_ID>';  -- 0: a guest has no password
SELECT count(*) FROM auth_sessions WHERE user_id = '<GUEST_ID>';  -- 1
```

- `handle` and `name` are the same `guest-…` value
- the email looks like `temp-…@guest.lineup.invalid`, an address that can never receive mail
- `is_anonymous` is `true`

---

## Step 2 — Give the guest some history (optional)

This proves an upgrade never loses history. It saves a small match, a solo game and stats for the guest.

The database has no defaults for `id` and `updated_at` (Prisma fills them in the app), so the SQL supplies them. Replace `<GUEST_ID>`:

```sql
WITH c AS (
  INSERT INTO competitions (id, slug, kind, name, updated_at)
  VALUES (gen_random_uuid(), 'test-manual-comp', 'league', 'Crown League', now()) RETURNING id
), s AS (
  INSERT INTO seasons (id, competition_id, label, start_year, updated_at)
  SELECT gen_random_uuid(), id, '2002-03', 2002, now() FROM c RETURNING id
), m AS (
  INSERT INTO matches (id, slug, season_id, date, updated_at)
  SELECT gen_random_uuid(), 'test-manual-match', id, '2003-05-03', now() FROM s RETURNING id
), g AS (
  INSERT INTO game_sessions (id, mode, match_id, updated_at)
  SELECT gen_random_uuid(), 'solo', id, now() FROM m RETURNING id
)
INSERT INTO game_participants (id, session_id, user_id, seat, updated_at)
SELECT gen_random_uuid(), id, '<GUEST_ID>', 0, now() FROM g;

INSERT INTO user_stats (user_id, played, updated_at) VALUES ('<GUEST_ID>', 1, now());
```

---

## Step 3 — Upgrade the guest

```bash
# Keep a copy of the guest cookie, to prove it stops working
cp /tmp/guest.jar /tmp/guest-old.jar

# Upgrade; the response sets a fresh cookie
curl -s -b /tmp/guest.jar -c /tmp/guest.jar -H 'content-type: application/json' \
  -d '{"email":"upgrade-test@example.com","password":"correct-horse","handle":"upgradetest"}' \
  http://localhost:8080/auth/upgrade

# The new cookie: same id, now registered
curl -s -b /tmp/guest.jar http://localhost:8080/auth/session

# The old guest cookie: signed out
curl -s -b /tmp/guest-old.jar http://localhost:8080/auth/session
```

**What to expect:**

- The upgrade returns the **same `id`** as Step 1, with `"handle": "upgradetest"` and `"isGuest": false`
- The new cookie reads back the same user
- The old cookie reads back `{ "success": true, "data": null }`

**In the database:**

```sql
SELECT id, handle, name, email, is_anonymous, email_verified FROM users WHERE id = '<GUEST_ID>';
SELECT provider_id, account_id, left(password, 20) AS hash_start FROM auth_accounts WHERE user_id = '<GUEST_ID>';
SELECT count(*) FROM auth_sessions WHERE user_id = '<GUEST_ID>';      -- 1: the guest session is gone
SELECT count(*) FROM game_participants WHERE user_id = '<GUEST_ID>';  -- 1, if you did Step 2
SELECT played FROM user_stats WHERE user_id = '<GUEST_ID>';           -- 1, if you did Step 2
```

- The `users` row keeps its id. `is_anonymous` is `false`, `email` is the new address in lower case, `handle` and `name` are `upgradetest`, and `email_verified` is `false` (B11b verifies it).
- One `credential` account, whose `account_id` is the user id. The password column holds a hash, never your password.
- The game and the stats are still attached to the same id.

---

## Step 4 — Sign out and back in

```bash
curl -s -b /tmp/guest.jar -c /tmp/guest.jar -X POST http://localhost:8080/auth/sign-out

curl -s -c /tmp/guest.jar -H 'content-type: application/json' \
  -d '{"email":"upgrade-test@example.com","password":"correct-horse"}' \
  http://localhost:8080/auth/sign-in
```

**What to expect:** sign-out returns `"data": null`, and sign-in returns the same `id` once more.

---

## Step 5 — Refusals

With the registered account from Step 4:

```bash
# No cookie → 401 unauthorized, "Sign in or continue as a guest first."
curl -s -H 'content-type: application/json' \
  -d '{"email":"a-test@example.com","password":"correct-horse","handle":"atest"}' \
  http://localhost:8080/auth/upgrade

# Upgrading a registered account → 403 forbidden, "This account is already registered."
curl -s -b /tmp/guest.jar -H 'content-type: application/json' \
  -d '{"email":"b-test@example.com","password":"correct-horse","handle":"btest"}' \
  http://localhost:8080/auth/upgrade

# Continue as guest while signed in → 403 forbidden, "Sign out first."
curl -s -b /tmp/guest.jar -X POST http://localhost:8080/auth/guest
```

With a fresh guest. Each of these gives `400 invalid_input`, and the guest stays a guest:

```bash
curl -s -c /tmp/g2.jar -X POST http://localhost:8080/auth/guest

# Taken handle, in any case → "That handle is taken."
curl -s -b /tmp/g2.jar -H 'content-type: application/json' \
  -d '{"email":"c-test@example.com","password":"correct-horse","handle":"YUNUS"}' \
  http://localhost:8080/auth/upgrade

# Email already registered, in any case → "That email is already registered."
curl -s -b /tmp/g2.jar -H 'content-type: application/json' \
  -d '{"email":"Upgrade-Test@example.com","password":"correct-horse","handle":"ctest"}' \
  http://localhost:8080/auth/upgrade

# Bad body → "Check these fields: email, password, handle."
curl -s -b /tmp/g2.jar -H 'content-type: application/json' \
  -d '{"email":"nope","password":"short","handle":"a b"}' \
  http://localhost:8080/auth/upgrade

# Still a guest
curl -s -b /tmp/g2.jar http://localhost:8080/auth/session
```

**What to expect:** the last call still returns `"isGuest": true`. None of the error messages repeat the email or the handle.

---

## Step 6 — A guest signs in to an existing account

```bash
curl -s -b /tmp/g2.jar -c /tmp/g2.jar -H 'content-type: application/json' \
  -d '{"email":"upgrade-test@example.com","password":"correct-horse"}' \
  http://localhost:8080/auth/sign-in
```

**What to expect:** the `upgradetest` account's session. The guest from `/tmp/g2.jar` is neither merged nor deleted (B11a Open Questions 2), so it's still listed:

```sql
SELECT id, handle FROM users WHERE is_anonymous;
```

---

## Step 7 — Native guest routes are closed

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8080/api/auth/sign-in/anonymous      # 404
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8080/api/auth/delete-anonymous-user  # 404
```

Clients only use `/auth/guest` and `/auth/upgrade`. You can also call both from the Swagger UI at http://localhost:8080/docs, though curl makes it easier to keep two devices apart.

---

## Clean up

Delete in this order: a user with game history can't be deleted until the game is.

```sql
DELETE FROM game_sessions WHERE match_id IN (SELECT id FROM matches WHERE slug = 'test-manual-match');
DELETE FROM matches WHERE slug = 'test-manual-match';
DELETE FROM seasons WHERE competition_id IN (SELECT id FROM competitions WHERE slug = 'test-manual-comp');
DELETE FROM competitions WHERE slug = 'test-manual-comp';
DELETE FROM users WHERE is_anonymous OR email LIKE '%-test@example.com';  -- sessions, accounts and stats go with them
```

Then remove the cookie files: `rm /tmp/guest.jar /tmp/guest-old.jar /tmp/g2.jar`.

---

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `/auth/session` returns `null` right after `/auth/guest` | curl wasn't given the cookie file (`-b /tmp/guest.jar`) |
| A second `/auth/guest` creates a new id | The first call's cookie wasn't saved (`-c`), or a different file was passed |
| Upgrade returns `unauthorized` | No cookie sent, or the guest session expired or was deleted |
| Upgrade returns `forbidden` | The cookie belongs to a registered account, or the guest was already upgraded |
| The old cookie still works after an upgrade | `/tmp/guest-old.jar` was copied after the upgrade instead of before |
| Deleting a user fails with a foreign key error | It still has game history: delete its `game_sessions` first (see Clean up) |
| Step 2's SQL fails on a `season` CHECK | The label and start year must match (`2002-03` with `2002`) |
| Step 2's SQL fails on a duplicate slug | Step 2 already ran; run the Clean up first |
