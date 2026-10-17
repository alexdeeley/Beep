import { useEffect, useId, useRef } from 'react';
import { CHAR_GROUPS, charName, groupLabel } from '../data/character-sets';
import type { ProjectStore } from '../modules/storage/project-store';
import { STATUS_MARK, STATUS_TEXT } from './ui';

/** Buttons for each character group in the project; each jumps to that group's first unfinished character. */
export function GroupTabs({ store, current, onJump }: { store: ProjectStore; current: string; onJump(char: string): void }) {
  const groups = [...new Set(store.inventory.map((e) => e.groupId))];
  const currentGroup = store.inventory.find((e) => e.char === current)?.groupId;
  return (
    <nav className="group-tabs" aria-label="Character groups">
      {groups.map((g) => {
        const entries = store.inventory.filter((e) => e.groupId === g);
        const target = entries.find((e) => store.status(e.char) !== 'complete') ?? entries[0];
        const done = entries.filter((e) => store.status(e.char) === 'complete').length;
        const short = CHAR_GROUPS.find((x) => x.id === g)?.short ?? '✎';
        return (
          <button
            key={g}
            className="group-tab"
            aria-current={g === currentGroup ? 'true' : undefined}
            onClick={() => onJump(target.char)}
            aria-label={`${groupLabel(g)}: ${done} of ${entries.length} complete`}
          >
            <span className="group-short" aria-hidden="true">{short}</span>
            <span className="group-name" aria-hidden="true">{groupLabel(g)}</span>
            <span className="group-count" aria-hidden="true">{done}/{entries.length}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** A full-screen sheet listing every character, to jump straight to one. */
export function CharacterPicker({ store, open, current, onPick, onClose }: { store: ProjectStore; open: boolean; current: string; onPick(char: string): void; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);
  const groups = [...new Set(store.inventory.map((e) => e.groupId))];
  return (
    <dialog ref={ref} className="dialog sheet" aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onClose(); }} onClose={onClose}>
      <div className="dialog-body">
        <div className="sheet-head">
          <h2 id={titleId}>Jump to a character</h2>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
        {groups.map((g) => (
          <section key={g} aria-label={groupLabel(g)}>
            <h3 className="sheet-group">{groupLabel(g)}</h3>
            <div className="picker-grid">
              {store.inventory.filter((e) => e.groupId === g).map(({ char }) => {
                const st = store.status(char);
                return (
                  <button
                    key={char}
                    className={`picker-cell st-${st}`}
                    aria-current={char === current ? 'true' : undefined}
                    aria-label={`${charName(char)}, ${STATUS_TEXT[st]}`}
                    onClick={() => onPick(char)}
                  >
                    <span className="picker-char" aria-hidden="true">{char}</span>
                    <span className="picker-mark" aria-hidden="true">{STATUS_MARK[st]}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </dialog>
  );
}
