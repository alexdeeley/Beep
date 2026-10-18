// PIN authentication for one person. The PIN is never stored: a PBKDF2
// hash with a random salt is. Sessions are random tokens kept only as a
// hash, with an idle timeout the owner sets. Guessing is throttled: after
// five wrong tries the lock lasts a minute and doubles each time.
import type { SqlDriver } from './driver.ts';
import { one } from './driver.ts';
import { getSetting, setSetting, now, newId } from './db.ts';

export class AuthError extends Error { status: number; retryAfterSec?: number; constructor(status: number, message: string, retryAfterSec?: number) { super(message); this.status = status; this.retryAfterSec = retryAfterSec; } }

const enc = new TextEncoder();
export const PBKDF2_ITERATIONS = 210_000;
const b64u = (b: ArrayBuffer | Uint8Array): string => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function sha256(s: string): Promise<string> { return b64u(await crypto.subtle.digest('SHA-256', enc.encode(s))); }

export async function hashPin(pin: string, saltB64?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltB64 ? Uint8Array.from(atob(saltB64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer, iterations: PBKDF2_ITERATIONS }, key, 256);
  return { hash: b64u(bits), salt: b64u(salt) };
}

// Constant-time string comparison.
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export const validPin = (pin: unknown): pin is string => typeof pin === 'string' && /^\d{4,12}$/.test(pin);

export interface Session { id: string; label: string; createdAt: string; lastSeenAt: string }

export const LOCK_CHOICES = [1, 5, 15, 60, 480, 43200] as const;   // minutes; 43200 = 30 days ("never")

export class AuthService {
  private db: SqlDriver; private recoveryKey: string | undefined;
  constructor(db: SqlDriver, recoveryKey: string | undefined) { this.db = db; this.recoveryKey = recoveryKey; }

  isSetUp(): boolean { return !!getSetting(this.db, 'pin_hash'); }
  hasRecoveryKey(): boolean { return !!this.recoveryKey && this.recoveryKey.length >= 12; }
  lockTimeoutMin(): number { return Number(getSetting(this.db, 'lock_timeout_min') ?? 15); }

  // ── throttling: shared across the whole installation (there is one owner) ──
  private lockout(): number {
    const t = Date.now();
    const recent = this.db.query("SELECT at, ok FROM attempts WHERE at > ? ORDER BY id DESC", [new Date(t - 24 * 3600_000).toISOString()]);
    let streak = 0; for (const r of recent) { if (Number(r.ok)) break; streak++; }
    if (streak < 5) return 0;
    const last = recent[0] ? Date.parse(String(recent[0].at)) : 0;
    const lockMs = Math.min(60 * 60_000, 60_000 * Math.pow(2, streak - 5));
    return Math.max(0, Math.ceil((last + lockMs - t) / 1000));
  }
  private record(ok: boolean, kind: string): void {
    this.db.query('INSERT INTO attempts (at, ok, kind) VALUES (?, ?, ?)', [now(), ok ? 1 : 0, kind]);
    this.db.query("DELETE FROM attempts WHERE at < ?", [new Date(Date.now() - 7 * 24 * 3600_000).toISOString()]);
  }
  private guard(): void { const wait = this.lockout(); if (wait > 0) throw new AuthError(429, `Too many wrong tries. Wait ${wait >= 60 ? Math.ceil(wait / 60) + ' minute' + (wait >= 120 ? 's' : '') : wait + ' seconds'} and try again.`, wait); }
  lockedForSec(): number { return this.lockout(); }

  private async checkPin(pin: string): Promise<boolean> {
    const hash = getSetting(this.db, 'pin_hash'), salt = getSetting(this.db, 'pin_salt');
    if (!hash || !salt) return false;
    return safeEqual((await hashPin(pin, salt)).hash, hash);
  }
  private checkRecovery(key: unknown): boolean {
    if (!this.hasRecoveryKey() || typeof key !== 'string') return false;
    return safeEqual(key.trim(), this.recoveryKey!.trim());
  }
  private async storePin(pin: string): Promise<void> {
    const { hash, salt } = await hashPin(pin);
    setSetting(this.db, 'pin_hash', hash); setSetting(this.db, 'pin_salt', salt);
    setSetting(this.db, 'pin_changed_at', now());
  }

  // First run: the recovery key (a Worker secret only the owner knows) sets the PIN.
  async setup(recoveryKey: unknown, pin: unknown, label: string): Promise<string> {
    if (this.isSetUp()) throw new AuthError(409, 'A PIN is already set. Use the recovery key on the lock screen to reset it.');
    if (!this.hasRecoveryKey()) throw new AuthError(503, 'No recovery key is configured on the server yet, so a PIN cannot be set. See the README: set the TODO_RECOVERY_KEY secret.');
    this.guard();
    if (!this.checkRecovery(recoveryKey)) { this.record(false, 'recovery'); throw new AuthError(401, 'That recovery key is not right.'); }
    if (!validPin(pin)) throw new AuthError(400, 'The PIN must be 4 to 12 digits.');
    this.record(true, 'recovery');
    await this.storePin(pin);
    return this.createSession(label);
  }

  // Forgot the PIN: the recovery key sets a new one and signs every device out.
  async recover(recoveryKey: unknown, pin: unknown, label: string): Promise<string> {
    if (!this.hasRecoveryKey()) throw new AuthError(503, 'No recovery key is configured on the server.');
    this.guard();
    if (!this.checkRecovery(recoveryKey)) { this.record(false, 'recovery'); throw new AuthError(401, 'That recovery key is not right.'); }
    if (!validPin(pin)) throw new AuthError(400, 'The PIN must be 4 to 12 digits.');
    this.record(true, 'recovery');
    await this.storePin(pin);
    this.db.query('DELETE FROM sessions');
    return this.createSession(label);
  }

  async login(pin: unknown, label: string): Promise<string> {
    if (!this.isSetUp()) throw new AuthError(409, 'No PIN is set yet.');
    this.guard();
    if (!validPin(pin) || !(await this.checkPin(pin))) { this.record(false, 'pin'); const wait = this.lockout(); throw new AuthError(401, wait ? `Wrong PIN. Locked for ${wait} seconds.` : 'Wrong PIN.', wait || undefined); }
    this.record(true, 'pin');
    return this.createSession(label);
  }

  async changePin(token: string | null, current: unknown, next: unknown): Promise<void> {
    const s = await this.session(token);
    if (!s) throw new AuthError(401, 'Not signed in.');
    this.guard();
    if (!validPin(current) || !(await this.checkPin(current))) { this.record(false, 'pin'); throw new AuthError(401, 'The current PIN is not right.'); }
    if (!validPin(next)) throw new AuthError(400, 'The new PIN must be 4 to 12 digits.');
    this.record(true, 'pin');
    await this.storePin(next);
    this.db.query('DELETE FROM sessions WHERE id <> ?', [s.id]);   // every other device must sign in again
  }

  private async createSession(label: string): Promise<string> {
    const raw = new Uint8Array(32); crypto.getRandomValues(raw);
    const token = b64u(raw);
    const t = now();
    this.db.query('INSERT INTO sessions (id, label, created_at, last_seen_at) VALUES (?,?,?,?)', [await sha256(token), label.slice(0, 80), t, t]);
    return token;
  }

  // The session behind a cookie token, or null. Enforces the idle timeout
  // and a 30-day absolute life; touches last_seen on every call.
  async session(token: string | null): Promise<Session | null> {
    if (!token) return null;
    const id = await sha256(token);
    const r = one(this.db.query('SELECT * FROM sessions WHERE id = ?', [id]));
    if (!r) return null;
    const t = Date.now(), seen = Date.parse(String(r.last_seen_at)), made = Date.parse(String(r.created_at));
    if (t - seen > this.lockTimeoutMin() * 60_000 || t - made > 30 * 24 * 3600_000) { this.db.query('DELETE FROM sessions WHERE id = ?', [id]); return null; }
    this.db.query('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [now(), id]);
    return { id, label: String(r.label), createdAt: String(r.created_at), lastSeenAt: String(r.last_seen_at) };
  }
  async logout(token: string | null): Promise<void> { if (token) this.db.query('DELETE FROM sessions WHERE id = ?', [await sha256(token)]); }
  logoutAll(): void { this.db.query('DELETE FROM sessions'); }
  sessions(): Session[] { return this.db.query('SELECT * FROM sessions ORDER BY last_seen_at DESC').map((r) => ({ id: String(r.id), label: String(r.label), createdAt: String(r.created_at), lastSeenAt: String(r.last_seen_at) })); }
}

export { newId };
