import { describe, expect, it } from 'vitest';
import { BackupError, createBackup, parseBackup } from '../src/modules/project-import-export/backup';
import { record, testProject } from './fixtures';

describe('project backup', () => {
  const project = testProject({ customChars: 'ß' });
  const recs = [record(project.id, 'A'), { ...record(project.id, 'b'), status: 'needs-revision' as const }];

  it('round-trips the project and the original strokes', () => {
    const text = JSON.stringify(createBackup(project, recs));
    const { project: p, records } = parseBackup(text);
    expect(p.id).toBe(project.id);
    expect(p.familyName).toBe('Test Hand');
    expect(p.customChars).toBe('ß');
    expect(records.map((r) => r.char)).toEqual(['A', 'b']);
    expect(records[1].status).toBe('needs-revision');
    expect(records[0].strokes.length).toBe(recs[0].strokes.length);
    expect(records[0].strokes[0].points.length).toBe(recs[0].strokes[0].points.length);
  });

  it('rejects files that are not backups with a clear message', () => {
    expect(() => parseBackup('not json')).toThrow(BackupError);
    expect(() => parseBackup('{"format":"something-else"}')).toThrow(/not an Inkprint project backup/);
    expect(() => parseBackup('{"format":"inkprint-project","formatVersion":99,"glyphs":[]}')).toThrow(/newer version/);
  });

  it('drops malformed strokes and clamps settings', () => {
    const b = createBackup(project, recs) as unknown as Record<string, any>;
    b.project.stroke.size = 1e9;
    b.glyphs[0].strokes.push({ pen: false, points: [1, 2] }, { pen: false, points: [1, 'x', 3] });
    const { project: p, records } = parseBackup(JSON.stringify(b));
    expect(p.stroke.size).toBe(160);
    expect(records[0].strokes.length).toBe(recs[0].strokes.length);
  });
});

describe('project upgrades on open', async () => {
  const { upgradeProject } = await import('../src/modules/storage/project-store');
  const { DEFAULT_GHOST, PREVIOUS_GHOST_OPACITY } = await import('../src/types/project');

  it('raises the guide letter from the old 18% default to the current default', () => {
    const old = testProject({ ghost: { ...DEFAULT_GHOST, opacity: PREVIOUS_GHOST_OPACITY } });
    const up = upgradeProject(old);
    expect(up.ghost.opacity).toBe(DEFAULT_GHOST.opacity);
    expect(DEFAULT_GHOST.opacity).toBeCloseTo(PREVIOUS_GHOST_OPACITY * 2, 2);
    expect(up).not.toBe(old);
  });

  it('leaves an opacity someone chose on purpose alone, and returns the same object when nothing applies', () => {
    const chosen = testProject({ ghost: { ...DEFAULT_GHOST, opacity: 0.25 } });
    expect(upgradeProject(chosen)).toBe(chosen);
    const fresh = testProject();
    expect(upgradeProject(fresh)).toBe(fresh);
  });
});
