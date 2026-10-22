/**
 * A font quality check: compares letters that should share a height or a
 * baseline and flags the ones that stray from the rest of the user's own
 * letters (not from the guides, so a deliberately tall or bouncy hand is not
 * punished, only inconsistency within it).
 */
import type { FontMetrics } from '../../types/font-metrics';

export interface Box {
  yMin: number;
  yMax: number;
  xMin: number;
  xMax: number;
}

export interface QualityIssue {
  char: string;
  message: string;
  severity: 'notice' | 'warning';
}

const CLASSES = {
  caps: { chars: 'ABCDEFGHIKLMNOPRSTUVWXYZ', top: 'cap height' },
  xLetters: { chars: 'acemnorsuvwxz', top: 'x-height' },
  ascenders: { chars: 'bdfhkl', top: 'ascender height' },
  digits: { chars: '0123456789', top: 'number height' },
} as const;
const ON_BASELINE = 'ABCDEFGHIKLMNOPRSTUVWXYZabcdefhiklmnorstuvwxz0123456789';
const DESCENDERS = 'gjpqy';

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function checkConsistency(boxes: Map<string, Box>, metrics: FontMetrics): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const tol = metrics.capHeight * 0.12;
  for (const cls of Object.values(CLASSES)) {
    const present = [...cls.chars].filter((c) => boxes.has(c));
    if (present.length < 3) continue;
    const med = median(present.map((c) => boxes.get(c)!.yMax));
    for (const c of present) {
      const d = boxes.get(c)!.yMax - med;
      if (Math.abs(d) > tol) {
        issues.push({
          char: c,
          severity: Math.abs(d) > tol * 2 ? 'warning' : 'notice',
          message: `${c} is ${d > 0 ? 'taller' : 'shorter'} than your other letters of its kind (${Math.round(Math.abs(d))} units ${d > 0 ? 'above' : 'below'} your usual ${cls.top}).`,
        });
      }
    }
  }
  const baseTol = metrics.capHeight * 0.08;
  for (const c of ON_BASELINE) {
    const b = boxes.get(c);
    if (!b) continue;
    if (b.yMin > baseTol) issues.push({ char: c, severity: b.yMin > baseTol * 2 ? 'warning' : 'notice', message: `${c} floats ${Math.round(b.yMin)} units above the baseline.` });
    else if (b.yMin < -baseTol * 1.5) issues.push({ char: c, severity: 'notice', message: `${c} dips ${Math.round(-b.yMin)} units below the baseline.` });
  }
  const desc = [...DESCENDERS].filter((c) => boxes.has(c));
  for (const c of desc) {
    const b = boxes.get(c)!;
    if (b.yMin > -metrics.capHeight * 0.1) issues.push({ char: c, severity: 'warning', message: `${c} has no descender: it should reach below the baseline.` });
  }
  if (desc.length >= 3) {
    const med = median(desc.map((c) => boxes.get(c)!.yMin));
    for (const c of desc) {
      const d = boxes.get(c)!.yMin - med;
      if (Math.abs(d) > tol * 1.5 && boxes.get(c)!.yMin < -metrics.capHeight * 0.1)
        issues.push({ char: c, severity: 'notice', message: `${c}'s descender is ${d < 0 ? 'deeper' : 'shallower'} than your other descenders.` });
    }
  }
  const order = (c: string) => ON_BASELINE.indexOf(c);
  return issues.sort((a, b) => (a.severity === b.severity ? order(a.char) - order(b.char) : a.severity === 'warning' ? -1 : 1));
}
