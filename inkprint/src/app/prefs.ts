import { useEffect, useState } from 'react';

/** Display preferences for this device (not part of any project). */
export interface Prefs {
  textScale: 1 | 1.15 | 1.3;
  highContrast: boolean;
}

const KEY = 'inkprint.prefs';
const DEFAULTS: Prefs = { textScale: 1, highContrast: false };

function read(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

let current = typeof window === 'undefined' ? DEFAULTS : read();
const listeners = new Set<(p: Prefs) => void>();

export function applyPrefs(p: Prefs) {
  const root = document.documentElement;
  root.style.setProperty('--text-scale', String(p.textScale));
  root.dataset.contrast = p.highContrast ? 'high' : 'normal';
}

export function setPrefs(patch: Partial<Prefs>) {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private mode: keep in memory */ }
  applyPrefs(current);
  listeners.forEach((fn) => fn(current));
}

export function usePrefs(): Prefs {
  const [p, setP] = useState(current);
  useEffect(() => {
    listeners.add(setP);
    return () => { listeners.delete(setP); };
  }, []);
  return p;
}

export function initPrefs() {
  applyPrefs(current);
}
