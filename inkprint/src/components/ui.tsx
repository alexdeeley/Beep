import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { GlyphStatus } from '../types/glyph';

/* ---------- live announcements (screen readers + visible toast) ---------- */

type Toast = { id: number; text: string };
let toastListener: ((t: Toast) => void) | null = null;
let toastId = 0;

/** Shows a short status message and reads it to screen readers. */
export function announce(text: string) {
  toastListener?.({ id: ++toastId, text });
}

export function Announcer() {
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => {
    toastListener = setToast;
    return () => { toastListener = null; };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && <div className="toast" key={toast.id}>{toast.text}</div>}
    </div>
  );
}

/* ---------- dialogs ---------- */

export interface DialogChoice {
  label: string;
  value: string;
  kind?: 'primary' | 'danger' | 'secondary';
}

interface DialogRequest {
  title: string;
  message: ReactNode;
  choices: DialogChoice[];
  resolve(v: string | null): void;
}

let dialogListener: ((d: DialogRequest) => void) | null = null;

/** Opens a modal with the given choices; resolves to the chosen value, or null when dismissed. */
export function choose(title: string, message: ReactNode, choices: DialogChoice[]): Promise<string | null> {
  return new Promise((resolve) => {
    if (!dialogListener) { resolve(window.confirm(title) ? choices[0].value : null); return; }
    dialogListener({ title, message, choices, resolve });
  });
}

export async function confirmAction(title: string, message: ReactNode, confirmLabel: string, danger = false): Promise<boolean> {
  const v = await choose(title, message, [
    { label: confirmLabel, value: 'yes', kind: danger ? 'danger' : 'primary' },
    { label: 'Cancel', value: 'no', kind: 'secondary' },
  ]);
  return v === 'yes';
}

export function DialogHost() {
  const [req, setReq] = useState<DialogRequest | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    dialogListener = setReq;
    return () => { dialogListener = null; };
  }, []);
  useEffect(() => {
    const d = ref.current;
    if (req && d && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
  }, [req]);
  const close = (v: string | null) => {
    ref.current?.close?.();
    req?.resolve(v);
    setReq(null);
  };
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); close(null); }}>
      {req && (
        <div className="dialog-body">
          <h2 id={titleId}>{req.title}</h2>
          <div className="dialog-message">{req.message}</div>
          <div className="dialog-actions">
            {req.choices.map((c, i) => (
              <button key={c.value} className={`btn btn-${c.kind ?? 'secondary'}`} autoFocus={i === req.choices.length - 1} onClick={() => close(c.value)}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </dialog>
  );
}

/* ---------- form controls ---------- */

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange(v: number): void;
  format?(v: number): string;
  hint?: string;
}) {
  const id = useId();
  const { label, value, min, max, step, onChange, format, hint } = props;
  return (
    <div className="field slider">
      <label htmlFor={id}>
        <span>{label}</span>
        <output htmlFor={id}>{format ? format(value) : value}</output>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-describedby={hint ? `${id}-hint` : undefined} />
      {hint && <p className="hint" id={`${id}-hint`}>{hint}</p>}
    </div>
  );
}

export function TextField(props: { label: string; value: string; onChange(v: string): void; hint?: string; maxLength?: number; placeholder?: string; autoFocus?: boolean; name?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        name={props.name}
        type="text"
        value={props.value}
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
        autoComplete="off"
        onChange={(e) => props.onChange(e.target.value)}
        aria-describedby={props.hint ? `${id}-hint` : undefined}
      />
      {props.hint && <p className="hint" id={`${id}-hint`}>{props.hint}</p>}
    </div>
  );
}

/* ---------- status ---------- */

export const STATUS_TEXT: Record<GlyphStatus, string> = {
  empty: 'Not started',
  'in-progress': 'In progress',
  complete: 'Complete',
  'needs-revision': 'Needs revision',
};

/** Shape-coded status mark, so state never depends on colour alone. */
export const STATUS_MARK: Record<GlyphStatus, string> = {
  empty: '○',
  'in-progress': '◐',
  complete: '●',
  'needs-revision': '⚑',
};

export function StatusTag({ status }: { status: GlyphStatus }) {
  return (
    <span className={`status status-${status}`}>
      <span aria-hidden="true">{STATUS_MARK[status]}</span> {STATUS_TEXT[status]}
    </span>
  );
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return <div className="loading" role="status">{text}</div>;
}
