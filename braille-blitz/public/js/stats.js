// Statistics: everything the game remembers between sessions.
//
// Stored as one JSON object in whichever storage is handed in (localStorage
// in the browser, a plain Map-like object in tests). No account, no server.
//
// Mastery is defined here, in one place, and is deliberately simple:
// a character is MASTERED once it has at least MASTERY.minCorrect correct
// answers in total and at least MASTERY.minAccuracy over its most recent
// MASTERY.window attempts.

export const MASTERY = Object.freeze({ minCorrect: 5, window: 10, minAccuracy: 0.9 });
export const RECENT_KEEP = 60;        // how many recent answers are remembered
export const STORAGE_KEY = 'braille-blitz.stats.v1';

const empty = () => ({
  v: 1,
  total: 0, correct: 0,
  streak: 0, longest: 0,
  timeMs: 0,                           // time spent practising
  sessions: 0,
  chars: {},                           // key -> { attempts, correct, recent: [1|0...], ms: [..last 10] }
  recent: [],                          // [{ c: 1|0, ms, t, k }] newest last
  modes: {},                           // mode -> { total, correct }
});

export class Stats {
  constructor(storage, { key = STORAGE_KEY, now = Date.now } = {}) {
    this.storage = storage;
    this.key = key;
    this.now = now;
    this.data = empty();
    this.load();
  }

  load() {
    try {
      const raw = this.storage?.getItem(this.key);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.v === 1) this.data = { ...empty(), ...d };
      }
    } catch { /* corrupt or unavailable storage: start fresh */ }
    return this;
  }

  save() {
    try { this.storage?.setItem(this.key, JSON.stringify(this.data)); } catch { /* storage full or blocked */ }
  }

  reset() { this.data = empty(); this.save(); }

  // One answered question.
  record({ char, correct, ms = 0, mode = 'letters' }) {
    const d = this.data;
    d.total++;
    if (correct) { d.correct++; d.streak++; d.longest = Math.max(d.longest, d.streak); } else d.streak = 0;
    const c = d.chars[char] || (d.chars[char] = { attempts: 0, correct: 0, recent: [], ms: [] });
    c.attempts++;
    if (correct) c.correct++;
    c.recent.push(correct ? 1 : 0);
    if (c.recent.length > MASTERY.window) c.recent.splice(0, c.recent.length - MASTERY.window);
    if (ms > 0) { c.ms.push(Math.round(ms)); if (c.ms.length > 10) c.ms.splice(0, c.ms.length - 10); }
    d.recent.push({ c: correct ? 1 : 0, ms: Math.round(ms), t: this.now(), k: char });
    if (d.recent.length > RECENT_KEEP) d.recent.splice(0, d.recent.length - RECENT_KEEP);
    const m = d.modes[mode] || (d.modes[mode] = { total: 0, correct: 0 });
    m.total++; if (correct) m.correct++;
    this.save();
    return { streak: d.streak, longest: d.longest };
  }

  addTime(ms) { if (ms > 0) { this.data.timeMs += ms; this.save(); } }
  addSession() { this.data.sessions++; this.save(); }

  char(key) {
    return this.data.chars[key] || { attempts: 0, correct: 0, recent: [], ms: [] };
  }

  // Accuracy over the recent window (0..1), or null if never attempted.
  recentAccuracy(key) {
    const c = this.char(key);
    if (!c.recent.length) return null;
    return c.recent.reduce((a, b) => a + b, 0) / c.recent.length;
  }

  // Share of recent attempts that were wrong, 0 if never seen.
  missRate(key) {
    const a = this.recentAccuracy(key);
    return a == null ? 0 : 1 - a;
  }

  isMastered(key) {
    const c = this.char(key);
    const acc = this.recentAccuracy(key);
    return c.correct >= MASTERY.minCorrect && acc != null && acc >= MASTERY.minAccuracy && c.recent.length >= Math.min(MASTERY.minCorrect, MASTERY.window);
  }

  // 'new' (never seen), 'learning', or 'mastered'.
  level(key) {
    if (!this.char(key).attempts) return 'new';
    return this.isMastered(key) ? 'mastered' : 'learning';
  }

  averageMs(key) {
    const c = this.char(key);
    return c.ms.length ? c.ms.reduce((a, b) => a + b, 0) / c.ms.length : null;
  }

  // Characters that have been missed and are not yet mastered - the review queue.
  weakChars(keys) {
    return keys.filter((k) => { const c = this.char(k); return c.attempts - c.correct > 0 && !this.isMastered(k); });
  }

  mostMissed(keys, n = 5) {
    return keys
      .map((k) => ({ key: k, misses: this.char(k).attempts - this.char(k).correct, attempts: this.char(k).attempts }))
      .filter((x) => x.misses > 0)
      .sort((a, b) => b.misses - a.misses || a.attempts - b.attempts)
      .slice(0, n);
  }

  // Accuracy over the last n answers overall (0..1), or null.
  recentOverall(n = 20) {
    const r = this.data.recent.slice(-n);
    if (!r.length) return null;
    return r.reduce((a, x) => a + x.c, 0) / r.length;
  }

  recentAverageMs(n = 20) {
    const r = this.data.recent.slice(-n).filter((x) => x.ms > 0);
    if (!r.length) return null;
    return r.reduce((a, x) => a + x.ms, 0) / r.length;
  }

  summary() {
    const d = this.data;
    return {
      total: d.total, correct: d.correct,
      accuracy: d.total ? d.correct / d.total : null,
      streak: d.streak, longest: d.longest,
      timeMs: d.timeMs, sessions: d.sessions,
      recent: d.recent.slice(),
      modes: { ...d.modes },
    };
  }
}
