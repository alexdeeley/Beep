const KEY = "wall.sessionId";

/** An anonymous per-browser id, stored locally and never displayed anywhere. */
export function getSessionId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}
