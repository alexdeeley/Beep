# Known limitations (Phase 1)

- No accounts. One installation, optionally locked by a single edit key.
  Collection visibility is recorded but not enforced, and the UI says so.
- No rankings or categories yet (Phase 3); collections are the precursor.
- No taste profile, so discovery is graph-based only (trail, adjacent,
  random). Dismissals last for the session, not across visits.
- No external metadata: everything is typed in by hand or imported.
- Images are URLs only; nothing is uploaded or proxied.
- One Durable Object holds the database: one region, bounded storage, no
  SQL console. See ADR 1 for the migration path.
- The rate limit is in memory and resets when the object restarts.
- Drag-and-drop is not implemented; reordering uses accessible up/down
  buttons. Drag will arrive with the ranking editor.
