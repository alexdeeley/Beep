import type { Camera } from "../shared/coords.js";

const HASH_RE = /^#(-?[\d.]+),(-?[\d.]+),([\d.]+)$/;

export function readCameraFromHash(): Camera | null {
  const m = HASH_RE.exec(location.hash);
  if (!m) return null;
  const x = Number(m[1]);
  const y = Number(m[2]);
  const z = Number(m[3]);
  if (![x, y, z].every(Number.isFinite) || z <= 0) return null;
  return { x, y, z };
}

let lastWritten = "";
export function writeCameraToHash(cam: Camera): void {
  const hash = `#${round(cam.x)},${round(cam.y)},${round(cam.z)}`;
  if (hash === lastWritten) return;
  lastWritten = hash;
  history.replaceState(null, "", hash);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Empty wall: open at the origin at zoom 1. Otherwise: frame the region
 * with the most recent activity, with a zoom floor so marks are never
 * microscopic on a very spread-out wall.
 */
export async function initialCamera(): Promise<Camera> {
  const fromHash = readCameraFromHash();
  if (fromHash) return fromHash;

  try {
    const res = await fetch("/api/activity");
    if (res.ok) {
      const data = (await res.json()) as { bbox: { minX: number; minY: number; maxX: number; maxY: number } | null };
      if (data.bbox) {
        const { minX, minY, maxX, maxY } = data.bbox;
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const spanX = Math.max(maxX - minX, 1);
        const spanY = Math.max(maxY - minY, 1);
        const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
        const vh = typeof window !== "undefined" ? window.innerHeight : 768;
        const z = Math.min(Math.min(vw / spanX, vh / spanY) * 0.7, 4);
        return { x: cx, y: cy, z: Math.max(z, 0.25) };
      }
    }
  } catch {
    /* fall through to origin default */
  }
  return { x: 0, y: 0, z: 1 };
}
