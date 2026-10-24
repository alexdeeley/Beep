// Generic named registry used by every extensible system
// (shapes, palettes, patterns, effects, sounds, recognizers, mappings, presets, panels, ...).
//
// Each entry must have a unique string `id`. A registry-specific `validate(def)` function
// returns an array of error strings (empty = valid). Registration is atomic: invalid
// definitions throw a RegistryError and are never stored.

export class RegistryError extends Error {
  constructor(registry, id, errors) {
    super(`[${registry}] cannot register "${id}": ${errors.join('; ')}`);
    this.registry = registry; this.id = id; this.errors = errors;
  }
}

export class Registry {
  constructor(name, { validate = () => [], events = null, allowReplace = false } = {}) {
    this.name = name;
    this._validate = validate;
    this._items = new Map();     // id -> { def, owner, order }
    this._events = events;
    this._allowReplace = allowReplace;
    this._order = 0;
  }

  register(def, owner = 'core') {
    const id = def && def.id;
    const errors = [];
    if (!id || typeof id !== 'string') errors.push('missing string id');
    else if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(id)) errors.push('id may only contain letters, digits, . _ : -');
    if (!errors.length) errors.push(...(this._validate(def) || []));
    if (!errors.length && this._items.has(id) && !this._allowReplace) {
      errors.push(`id already registered by "${this._items.get(id).owner}"`);
    }
    if (errors.length) throw new RegistryError(this.name, id || '?', errors);
    this._items.set(id, { def, owner, order: this._order++ });
    this._events?.emit('registry:changed', { registry: this.name, id, action: 'register', owner });
    return () => this.unregister(id);
  }

  unregister(id) {
    if (!this._items.delete(id)) return false;
    this._events?.emit('registry:changed', { registry: this.name, id, action: 'unregister' });
    return true;
  }

  unregisterOwner(owner) {
    for (const [id, item] of [...this._items]) if (item.owner === owner) this.unregister(id);
  }

  get(id) { return this._items.get(id)?.def; }
  has(id) { return this._items.has(id); }
  owner(id) { return this._items.get(id)?.owner; }
  ids() { return [...this._items.keys()]; }
  list() { return [...this._items.values()].sort((a, b) => a.order - b.order).map((i) => i.def); }
  get size() { return this._items.size; }
}

// Small validation helpers shared by registries.
export const need = {
  fn(def, key, errs) { if (typeof def[key] !== 'function') errs.push(`missing function "${key}"`); },
  optFn(def, key, errs) { if (def[key] !== undefined && typeof def[key] !== 'function') errs.push(`"${key}" must be a function`); },
  str(def, key, errs) { if (typeof def[key] !== 'string' || !def[key]) errs.push(`missing string "${key}"`); },
  obj(def, key, errs) { if (def[key] === null || typeof def[key] !== 'object') errs.push(`missing object "${key}"`); },
  arr(def, key, errs) { if (!Array.isArray(def[key])) errs.push(`missing array "${key}"`); },
};
