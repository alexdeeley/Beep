// Tiny DOM widget kit for panels. High contrast, big targets, uppercase labels, state
// always shown as TEXT (never colour alone). Widgets re-read their getter on refresh().

export function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

export function button(label, onClick, { cls = '', title } = {}) {
  return el('button', { class: `pr-btn ${cls}`, type: 'button', title: title || label, onclick: (e) => { e.stopPropagation(); onClick(e); } }, [label]);
}

// Toggle: shows "LABEL: ON/OFF"; aria-pressed reflects state.
export function toggle(label, get, set) {
  const b = el('button', { class: 'pr-btn pr-toggle', type: 'button' });
  const refresh = () => { const v = !!get(); b.textContent = `${label}: ${v ? 'ON' : 'OFF'}`; b.setAttribute('aria-pressed', String(v)); b.classList.toggle('is-on', v); };
  b.addEventListener('click', (e) => { e.stopPropagation(); set(!get()); refresh(); });
  refresh(); b.refresh = refresh;
  return b;
}

export function slider(label, { min, max, step = 0.01 }, get, set, fmt = (v) => (step >= 1 ? String(Math.round(v)) : (+v).toFixed(2))) {
  const value = el('span', { class: 'pr-slider-val' });
  const input = el('input', { type: 'range', min, max, step, 'aria-label': label });
  const refresh = () => { input.value = get(); value.textContent = fmt(+get()); };
  input.addEventListener('input', () => { set(+input.value); value.textContent = fmt(+input.value); });
  const wrap = el('label', { class: 'pr-slider' }, [el('span', { class: 'pr-slider-label', text: label }), value, input]);
  refresh(); wrap.refresh = refresh;
  return wrap;
}

// Segmented choice: options [{ value, label }]; the selected one is marked "● LABEL".
export function segmented(label, options, get, set, { cls = '' } = {}) {
  const row = el('div', { class: `pr-seg ${cls}`, role: 'group', 'aria-label': label });
  const btns = options.map((o) => {
    const b = el('button', { class: 'pr-btn pr-seg-btn', type: 'button' }, [o.label]);
    b.addEventListener('click', (e) => { e.stopPropagation(); set(o.value); refresh(); });
    row.append(b); return [o, b];
  });
  const refresh = () => { const v = get(); for (const [o, b] of btns) { const on = Array.isArray(v) ? v.includes(o.value) : o.value === v; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); b.textContent = (on ? '● ' : '') + o.label; } };
  refresh();
  const wrap = el('div', { class: 'pr-field' }, label ? [el('div', { class: 'pr-field-label', text: label }), row] : [row]);
  wrap.refresh = refresh;
  return wrap;
}

export function row(children, cls = '') { return el('div', { class: `pr-row ${cls}` }, children); }
export function note(text) { return el('p', { class: 'pr-note', text }); }

export function download(filename, data, type = 'application/json') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function pickFile(accept = '.json,application/json') {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept, style: 'display:none' });
    input.addEventListener('change', async () => { const f = input.files?.[0]; input.remove(); resolve(f ? await f.text() : null); });
    document.body.append(input); input.click();
  });
}
