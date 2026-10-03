// Gallery — Cloudflare Worker entry point. The pages themselves are static
// files served from ./public; the only dynamic part is the visitor's book:
//
//   GET    /api/book?rx=&rz=&r=      notes in and around a region of the museum
//   GET    /api/book/farthest        who has signed furthest from the entrance
//   GET    /api/book/latest          the newest notes
//   POST   /api/book                 leave a note { name, msg, x, z }
//   DELETE /api/book/:id             remove a note (owner: x-admin-key header)
//
// One Durable Object holds the whole book (SQLite storage), so everyone sees
// the same notes and the rate limits apply to everyone alike.

import { Book, handleBook } from './book.js';

export class VisitorBook {
  constructor(ctx, env) {
    this.env = env;
    this.book = new Book(ctx.storage.sql);
  }
  fetch(request) {
    return handleBook(this.book, request, { adminKey: this.env.ADMIN_KEY });
  }
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/book' || url.pathname.startsWith('/api/book/')) {
      return env.BOOK.get(env.BOOK.idFromName('the-book')).fetch(request);
    }
    return new Response('Not found', { status: 404 });
  },
};
