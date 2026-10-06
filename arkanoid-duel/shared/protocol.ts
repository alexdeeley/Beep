// What the browsers and the server say to each other. Browsers only ever send
// input (where the paddle should be) and button presses - never results.

import { NET, W } from './constants.ts';
import type { LevelMessage, Snapshot } from './sim.ts';
import type { Difficulty } from './ai.ts';

export type ClientMsg =
  | { t: 'hello'; code: string; pass: string; pid: string; name: string }
  | { t: 'in'; x: number }
  | { t: 'ready' }
  | { t: 'serve' }
  | { t: 'rematch' }
  | { t: 'lobby' }           // back to the lobby after a match
  | { t: 'wait' }            // keep waiting for a disconnected opponent
  | { t: 'leave' }           // stop waiting
  | { t: 'speed'; v: number }
  | { t: 'servemode'; v: 'alternate' | 'both' }
  | { t: 'ping'; c: number };

export type ErrorCode =
  | 'bad_request' | 'bad_passcode' | 'locked' | 'full' | 'not_found' | 'replaced' | 'rate' | 'timeout';

export type ServerMsg =
  | { t: 'welcome'; you: 1 | 2; code: string; st: number; names: [string, string]; solo?: Difficulty }
  | ({ t: 'level' } & LevelMessage)
  | ({ t: 's'; st: number } & Snapshot)
  | { t: 'pong'; c: number; st: number }
  | { t: 'err'; code: ErrorCode; say: string; retry?: number; left?: number }
  | { t: 'names'; names: [string, string] };

const PID = /^[A-Za-z0-9_-]{8,64}$/;
const CODE = /^[A-Z2-9]{4}$/;

export const cleanName = (v: unknown): string =>
  String(v ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NET.maxName);

export const cleanCode = (v: unknown): string => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
export const validCode = (code: string): boolean => CODE.test(code);
export const validPass = (pass: unknown): pass is string =>
  typeof pass === 'string' && pass.length >= NET.minPass && pass.length <= NET.maxPass && !/[\u0000-\u001f\u007f]/.test(pass);

// Anything that is not exactly a well-formed message becomes null.
export function parseClient(raw: unknown): ClientMsg | null {
  if (typeof raw !== 'string' || raw.length > NET.maxMessageBytes) return null;
  let m: any;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return null;
  switch (m.t) {
    case 'hello': {
      const code = cleanCode(m.code);
      if (!validPass(m.pass) || typeof m.pid !== 'string' || !PID.test(m.pid)) return null;
      return { t: 'hello', code, pass: m.pass, pid: m.pid, name: cleanName(m.name) };
    }
    case 'in':
      return typeof m.x === 'number' && Number.isFinite(m.x) ? { t: 'in', x: Math.max(-W, Math.min(2 * W, m.x)) } : null;
    case 'ready': case 'serve': case 'rematch': case 'lobby': case 'wait': case 'leave':
      return { t: m.t };
    case 'speed':
      return typeof m.v === 'number' ? { t: 'speed', v: m.v } : null;
    case 'servemode':
      return m.v === 'alternate' || m.v === 'both' ? { t: 'servemode', v: m.v } : null;
    case 'ping':
      return typeof m.c === 'number' && Number.isFinite(m.c) ? { t: 'ping', c: m.c } : null;
    default:
      return null;
  }
}

// ── Passcodes ────────────────────────────────────────────────

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

// The server never keeps a passcode, only this: a hash salted with the room code.
export async function hashPass(code: string, pass: string): Promise<string> {
  const data = new TextEncoder().encode(`arkanoid-duel:${code}:${pass}`);
  return hex(await crypto.subtle.digest('SHA-256', data));
}

export function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
