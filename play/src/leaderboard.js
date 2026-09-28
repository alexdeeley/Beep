// A single global high-score board, shared across every mini-game and every
// room - one Durable Object instance for the whole platform (see worker.js,
// which always addresses it by the same fixed name). It only ever stores
// what a MatchRoom hands it after a real match ends server-side; there is
// no public write path (see DECISIONS.md), so a name is the only thing a
// client ever actually supplies.

const MAX_ENTRIES = 20;
const MAX_NAME = 16;

export class Leaderboard {
  constructor(ctx) {
    this.ctx = ctx;
    this.entries = null;
    ctx.blockConcurrencyWhile(() => this.load());
  }

  async load() {
    this.entries = (await this.ctx.storage.get('entries')) || [];
  }

  save() {
    this.ctx.storage.put('entries', this.entries);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.split('/').pop();

    if (action === 'top') {
      return Response.json({ entries: this.entries });
    }

    if (action === 'check' && request.method === 'POST') {
      const score = Number((await request.json())?.score);
      return Response.json({ qualifies: this.qualifies(score) });
    }

    if (action === 'submit' && request.method === 'POST') {
      const body = await request.json();
      const name = cleanName(body?.name);
      const score = Number(body?.score);
      if (!name || !Number.isFinite(score) || score < 0 || !this.qualifies(score)) {
        return new Response('invalid', { status: 400 });
      }
      this.entries.push({ name, score, at: Date.now() });
      this.entries.sort((a, b) => b.score - a.score || a.at - b.at);
      this.entries = this.entries.slice(0, MAX_ENTRIES);
      this.save();
      return Response.json({ entries: this.entries });
    }

    return new Response('Not found', { status: 404 });
  }

  qualifies(score) {
    if (!Number.isFinite(score) || score <= 0) return false;
    if (this.entries.length < MAX_ENTRIES) return true;
    return score > this.entries[this.entries.length - 1].score;
  }
}

function cleanName(v) {
  return String(v || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}
