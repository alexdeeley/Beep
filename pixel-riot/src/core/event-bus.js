// Central publish/subscribe bus.
// - Listener exceptions are caught and reported on 'app:error' (never break emit).
// - `on` returns an unsubscribe function.
// - `scope(owner)` returns a bus view whose subscriptions can be removed in one call
//   (used by the plugin manager to clean up after an extension).
// - Wildcards: subscribe to 'gesture:*' to receive every event starting with 'gesture:'.

export class EventBus {
  constructor() {
    this._map = new Map();      // type -> Set<entry>
    this._wild = new Map();     // prefix -> Set<entry>
    this._emitting = 0;
    this.onError = null;        // (err, info) => void
  }

  on(type, fn, owner = 'core') {
    if (typeof fn !== 'function') throw new TypeError('EventBus.on: listener must be a function');
    const entry = { fn, owner };
    const wild = type.endsWith('*');
    const map = wild ? this._wild : this._map;
    const key = wild ? type.slice(0, -1) : type;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(entry);
    return () => { const s = map.get(key); if (s) s.delete(entry); };
  }

  once(type, fn, owner) {
    const off = this.on(type, (e) => { off(); fn(e); }, owner);
    return off;
  }

  off(type, fn) {
    const wild = type.endsWith('*');
    const map = wild ? this._wild : this._map;
    const s = map.get(wild ? type.slice(0, -1) : type);
    if (!s) return;
    for (const e of s) if (e.fn === fn) s.delete(e);
  }

  emit(type, payload) {
    const s = this._map.get(type);
    if (s) for (const e of [...s]) this._call(e, type, payload);
    if (this._wild.size) {
      for (const [prefix, set] of this._wild) {
        if (type.startsWith(prefix)) for (const e of [...set]) this._call(e, type, payload);
      }
    }
  }

  _call(entry, type, payload) {
    try { entry.fn(payload, type); }
    catch (err) {
      if (type === 'app:error') { console.error(err); return; }
      if (this.onError) this.onError(err, { type, owner: entry.owner });
      else console.error(`[event-bus] listener for "${type}" (${entry.owner}) threw`, err);
    }
  }

  removeOwner(owner) {
    for (const map of [this._map, this._wild]) {
      for (const set of map.values()) for (const e of [...set]) if (e.owner === owner) set.delete(e);
    }
  }

  listenerCount(type) {
    if (!type) {
      let n = 0;
      for (const map of [this._map, this._wild]) for (const s of map.values()) n += s.size;
      return n;
    }
    return (this._map.get(type)?.size || 0);
  }

  scope(owner) {
    const bus = this;
    const offs = new Set();
    return {
      on(type, fn) { const off = bus.on(type, fn, owner); offs.add(off); return () => { off(); offs.delete(off); }; },
      once(type, fn) { const off = bus.once(type, fn, owner); offs.add(off); return off; },
      off: (type, fn) => bus.off(type, fn),
      emit: (type, payload) => bus.emit(type, payload),
      dispose() { for (const off of offs) off(); offs.clear(); },
      get size() { return offs.size; },
    };
  }
}
