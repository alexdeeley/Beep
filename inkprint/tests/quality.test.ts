import { describe, expect, it } from 'vitest';
import { checkConsistency, type Box } from '../src/modules/quality/consistency';
import { DEFAULT_METRICS } from '../src/types/font-metrics';

const box = (yMin: number, yMax: number): Box => ({ xMin: 0, xMax: 100, yMin, yMax });

describe('consistency check', () => {
  it('flags a letter much taller than its siblings and one floating off the baseline', () => {
    const boxes = new Map<string, Box>([
      ['a', box(0, 480)], ['c', box(0, 470)], ['e', box(0, 490)], ['o', box(0, 485)], ['n', box(0, 640)],
      ['H', box(130, 830)], ['I', box(0, 700)], ['T', box(0, 710)],
    ]);
    const issues = checkConsistency(boxes, DEFAULT_METRICS);
    expect(issues.some((i) => i.char === 'n' && /taller/.test(i.message))).toBe(true);
    expect(issues.some((i) => i.char === 'H' && /floats/.test(i.message))).toBe(true);
    expect(issues.some((i) => i.char === 'a')).toBe(false);
  });

  it('flags a descender letter that sits on the baseline', () => {
    const issues = checkConsistency(new Map([['p', box(0, 480)]]), DEFAULT_METRICS);
    expect(issues[0].char).toBe('p');
  });

  it('is quiet for a consistent hand', () => {
    const boxes = new Map<string, Box>([['a', box(0, 480)], ['c', box(-5, 470)], ['e', box(3, 490)], ['g', box(-230, 480)]]);
    expect(checkConsistency(boxes, DEFAULT_METRICS)).toEqual([]);
  });
});
