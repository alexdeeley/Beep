# Security and privacy

## Today (Phase 1)

- **One installation, no accounts.** There are no users, passwords or
  sessions yet. Nothing personal is collected: no email, no tracking.
- **Changes can be locked.** If the Worker has the `EDIT_KEY` secret, every
  non-GET request must carry `x-edit-key`; the server checks it on every
  request (never the UI alone). Reads stay open. The key is kept in the
  editor's browser storage only. Without the secret the installation is
  open, which is fine for a personal install and is said so on the home page.
- **Validation and escaping.** Every input is validated on the server
  (`server/domain/validate.ts`): known types and attributes only, length
  limits, URLs must be http(s), years must be years. The client never sets
  HTML from data: all text goes through `textContent`.
- **Rate limit.** 120 changes a minute per address, in memory.
- **Audit trail.** `audit_events` records creates, updates and deletes.
- **Images.** Only URLs are stored, never uploaded files. They are shown with
  `alt=""` and never fetched by the server.
- **Secrets.** `EDIT_KEY` and `ANTHROPIC_API_KEY` are Worker secrets
  (`wrangler secret put`), read only on the server, never in client code or
  the repository. AI drafting is a write-class request: on a locked
  installation it needs the edit key, and it is limited to six a minute per
  address, so the key's budget cannot be spent by passers-by. Set
  `EDIT_KEY` whenever `ANTHROPIC_API_KEY` is set.
- **AI output is never trusted blindly.** Drafts are validated on the
  server like any other input, reviewed by a person, and marked
  `provider:anthropic` with an "AI-gathered · unverified" label.

## Phase 2 plan (accounts and profiles)

- Authentication on an established scheme rather than a home-made one:
  email magic links or passkeys (WebAuthn), with sessions in HttpOnly,
  Secure, SameSite cookies. If passwords are offered at all they are hashed
  with a current algorithm and never stored in plain text.
- `owner_id` on collections and notes becomes required; every owner-only
  action is checked on the server; private and unlisted objects are refused
  by direct URL and API unless the requester is allowed. The edit key goes.
- Profiles expose only what the user chose to publish; private notes,
  preferences and account details never appear on public pages or in the
  public API.
- Account export (the existing format, scoped to the user) and deletion.

## Later

Reporting, blocking, muting, comment controls, moderation tools with audit
trails, and community guidelines before open public submissions (Phase 6).
