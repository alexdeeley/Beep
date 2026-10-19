# To-do — todo.deeley.org

A private, personal to-do list for one person, as an installable web app:
PIN-locked, synchronised across devices, with reminders that arrive as
notifications at the time you set, even when the app is closed. Built for
low vision: black and white, bold Helvetica, large text and targets,
nothing said by colour alone.

## What it does

- **Lock.** A numeric PIN keypad. The PIN is stored only as a salted
  PBKDF2 hash; sessions are random tokens in an HttpOnly cookie; after
  five wrong tries the lock lasts a minute and doubles each time, for
  everyone; the session expires after the idle timeout you choose (1
  minute to 30 days) and the app locks itself at the same point.
- **Setup and recovery.** A PIN can only be set, or reset after it is
  forgotten, with the *recovery key*: the `TODO_RECOVERY_KEY` secret on
  the Worker. Nothing else can open an installation, so finding the URL
  gets a stranger a keypad and nothing more.
- **Tasks.** Title, person, notes, due date and time, reminder, priority
  (low / normal / high), status (to do / in progress / completed). Quick
  add from Today with one field; everything else under "More". Edit,
  complete, reopen, delete after confirming. Search by title, person or
  notes; filter by priority and person; sort by due date, priority or
  newest. Completed tasks are kept, not deleted.
- **Today first.** The app opens on Today: overdue, due today, no date,
  with one big Add button. Upcoming groups by day. All, Done, People
  (tasks per person), Reminders, Search, Settings.
- **Reminders.** Each task can have a reminder date and time. The server
  wakes at that instant (a Durable Object alarm), sends a Web Push
  notification to every device you turned notifications on, and marks the
  reminder sent so it can never fire twice. Editing the time re-arms it;
  completing or deleting the task cancels it; reopening a task whose
  reminder already passed fires it once. Times are set in the device's
  time zone and stored as instants, so clock changes do not shift them.
- **One list everywhere.** The server holds the tasks; every device shows
  the same list, refreshing on focus and every 45 seconds. Offline, the
  last list is shown from a local cache, changes are queued in an outbox
  and sent when the connection returns, and your typing in the Add form
  is kept across a refresh.
- **Export, backup, restore.** JSON or CSV downloads from Settings; a JSON
  download can be restored (tasks already present are skipped).

## Where things are

| Path | What |
|---|---|
| `server/worker.ts` | The Worker: `/api/*` to the `Vault` Durable Object, assets for the rest; the alarm handler |
| `server/api.ts` | Every route, the cookie, CSRF header, rate limit, and `deliverDue()` |
| `server/auth.ts` | PIN hashing, sessions, throttling, setup/recovery |
| `server/tasks.ts` | Task validation, storage, queries, reminder bookkeeping |
| `server/push.ts` | VAPID and RFC 8291 message encryption with WebCrypto |
| `server/db.ts` | Schema (one migration), settings helpers |
| `client/` | The app (`main.ts`), service worker (`sw.ts`), styles, manifest, icons |
| `dev/local-server.mjs` | The same API on node:sqlite, reminders on a timer |
| `dev/browser-test.mjs` | Playwright: setup, PIN, tasks, reminders, two devices, lock, PWA, accessibility |
| `tests/` | Node tests: auth, throttling, recovery, tasks, reminders, push crypto, settings |

## Running it locally

```sh
cd todo
npm install
TODO_RECOVERY_KEY=some-long-secret npm run dev     # http://127.0.0.1:8930
npm test                                           # Node tests on real SQLite
npm run test:browser                               # Playwright, screenshots in dev/shots
npm run typecheck
```

Environment: `PORT`, `TODO_DB` (`:memory:` for a throwaway database),
`TODO_RECOVERY_KEY` (required to set a PIN), `VAPID_SUBJECT` (a
`mailto:` address the push services can contact).

## Deploying

A Cloudflare Worker with one SQLite Durable Object and static assets, on
the same account as the rest of deeley.org. No other service is needed:
the database, the scheduler (Durable Object alarms) and the push sender
all run in the Worker. Push notifications go through the browsers' own
push services (Apple, Google, Mozilla), which are free.

1. **Add the repository secret `TODO_RECOVERY_KEY`** (the workflow also accepts the name `TODO_REPOSITORY_SECRET`) on GitHub (Settings →
   Secrets and variables → Actions): a long random string, kept in your
   password manager. It is the only way to set the first PIN and to reset
   a forgotten one. Without it the lock screen says so and nobody can get in.
2. Run the *Deploy Cloudflare Workers* workflow with the `todo` option.
   It runs the tests, deploys to `todo.deeley.org`, copies the recovery
   key into the Worker as a secret, and checks the site answers.
3. Open https://todo.deeley.org, enter the recovery key and choose a PIN.

The VAPID key pair for push is generated on first use and kept in the
database; nothing to configure. `VAPID_SUBJECT` in `wrangler.jsonc` is the
contact address push services may use.

### Checklist

| Needs | Where |
|---|---|
| Cloudflare API token and account id | repository secrets `CLOUDFLARE_API` (or `CLOUDFLARE_API_TOKEN`) and `CLOUDFLARE_ACCOUNT_ID` — already set for the other apps |
| `TODO_RECOVERY_KEY` | repository secret, copied to the Worker by the workflow (or `npx wrangler secret put TODO_RECOVERY_KEY` in `todo/`) |
| DNS | `todo.deeley.org` is a Worker custom domain; Cloudflare creates the record on the first deploy (allow a minute) |
| Database migrations | applied automatically on the first request after each deploy (`server/db.ts`) |
| Scheduled jobs | none to create: the Durable Object alarm re-arms itself whenever tasks change |

## Notifications on a real iPhone and on a desktop

**iPhone / iPad (iOS 16.4 or later).** Open https://todo.deeley.org in
Safari, tap Share, then *Add to Home Screen*. Open the *To-do* icon from
the Home Screen (not Safari), enter the PIN, go to Reminders and press
*Turn on notifications here*, then *Allow*. Press *Send a test*: a
notification should appear within a few seconds. Then add a task with a
reminder two minutes away, close the app, and wait. Notifications reach
only the Home Screen copy; Safari tabs do not get them. If nothing
arrives: iOS Settings → Notifications → To-do must be allowed, and Focus
or Do Not Disturb must be off.

**Desktop (Chrome, Edge, Firefox, Safari 16+).** Open the site, go to
Reminders, press *Turn on notifications here* and allow. *Send a test*
should show a system notification. Chrome and Edge also offer *Install*
in the address bar, which gives it a window of its own.

Each device is turned on separately and listed in Settings. Reminders are
sent to every device on the list.

## Security notes

- The PIN never leaves the device in clear except over https to the
  server, which hashes it (PBKDF2-SHA256, 100,000 iterations, the most
  Cloudflare Workers allow, random salt) and compares in constant time. Nothing stores the digits.
- The session cookie is `HttpOnly; Secure; SameSite=Lax`, 30 days at most,
  invalid after the idle timeout. Writes also require an `x-todo` header
  a cross-site form cannot send. Changing the PIN or recovering signs
  every other device out.
- Wrong PINs and wrong recovery keys share one throttle: five in a row
  locks everyone out for a minute, then two, four… up to an hour.
- Every API route except status, setup, login and recover requires a
  valid session; the server checks, not the interface.
- Push payloads are encrypted end to end for each device; the push
  services see ciphertext. Task titles are not in URLs (ids are), not in
  logs, and there are no analytics.
- Secrets: `TODO_RECOVERY_KEY` only, as a Worker secret. The VAPID private
  key lives in the Durable Object's storage, never in the client.
- Nothing is public: there are no shared lists, profiles or accounts for
  anyone else.

## Tested, and what needs a real device

Tested here: everything in `tests/` (10 Node tests) and
`dev/browser-test.mjs` (setup, wrong and right recovery key, PIN lock on a
second browser, wrong PIN, add/edit/complete/reopen/delete, overdue,
search, people, reminders page, persistence over reload and logout, sync
between two browsers, export, manifest and service worker, target sizes,
text size, contrast, keyboard focus). Push encryption is verified against
an independent decryptor in `tests/push.test.ts`, and the VAPID signature
against the public key.

Needs a real device: receiving an actual notification on an iPhone Home
Screen app and on a desktop browser (the steps above), and the alarm firing
on Cloudflare at the chosen minute. Both are standard platform behaviour,
but only a real push service proves the last mile.

## Not included, on purpose

Recurring tasks, calendar views, projects, sharing, collaboration, charts.
