// Main-screen chrome: a quiet top bar, a quick bar, the settings sheet, toasts and the
// diagnostics overlay. Uses only the public API (api.commands, api.settings, api.presets...).
//
// GESTURE CONFLICT POLICY: all UI lives in #ui, a DOM layer above the canvas. The layer
// itself is pointer-events:none; only its controls are pointer-events:auto, so touches on
// empty space fall through to the canvas and touches on controls never reach it. The UI
// dims while you play so it never competes with the artwork.

import { el, button } from './widgets.js';
import { APP_NAME } from '../config.js';

export function createControls(root, api) {
  const S = api.settings;
  const name = () => api.presets.current()?.name || '';
  const profileName = () => api.interactions.list().find((p) => p.id === api.presets.current()?.interaction)?.name || '';

  // ---- top: mode indicator + main buttons
  const label = el('div', { class: 'pr-label', 'aria-live': 'polite' });
  const btnPlay = button('', () => S.set('visual.animate', !S.get('visual.animate')), { cls: 'pr-icon' });
  const btnUndo = button('UNDO', () => { if (!api.commands.undo()) toast('NOTHING TO UNDO'); }, { cls: 'pr-icon' });
  const btnClear = button('CLEAR', () => { api.commands.clearArtwork(); toast('CLEARED — UNDO TO RESTORE'); }, { cls: 'pr-icon' });
  const btnSound = button('', () => { S.set('audio.enabled', !S.get('audio.enabled')); }, { cls: 'pr-icon' });
  const btnMenu = button('MENU', () => openSheet(), { cls: 'pr-icon' });
  // deeley.org: a way back to the site's menu, first in the bar.
  const btnHome = button('\u2039', () => { location.href = '../index.html'; }, { cls: 'pr-icon pr-home', title: 'BACK TO DEELEY.ORG' });
  btnHome.setAttribute('aria-label', 'Back to deeley.org');
  const top = el('div', { class: 'pr-top' }, [label, el('div', { class: 'pr-top-btns' }, [btnHome, btnPlay, btnUndo, btnClear, btnSound, btnMenu])]);

  // ---- bottom quick bar: one-tap changes
  const qPalette = button('', () => { api.commands.cycle('palette', 1); refresh(); });
  const qPattern = button('', () => { api.commands.cycle('pattern', 1); refresh(); });
  const qEffect = button('', () => { api.commands.cycle('interaction', 1); refresh(); toast(profileDesc()); });
  const qRandom = button('RANDOM', () => { api.commands.randomize(2); refresh(); toast(name()); });
  const qSave = button('SAVE', () => { const p = api.commands.saveCurrentPreset(); if (p) toast(`SAVED AS ${p.name}`); });
  const tempo = el('div', { class: 'pr-tempo' });
  const tDown = button('−', () => S.set('music.tempo', S.get('music.tempo') - 2), { cls: 'pr-small' });
  const tVal = el('span', { class: 'pr-tempo-val' });
  const tUp = button('+', () => S.set('music.tempo', S.get('music.tempo') + 2), { cls: 'pr-small' });
  const tTap = button('TAP', () => api.commands.tapTempo(), { cls: 'pr-small' });
  tempo.append(tDown, tVal, tUp, tTap);
  const bottom = el('div', { class: 'pr-bottom' }, [qPalette, qPattern, qEffect, qRandom, qSave, tempo]);
  const profileDesc = () => `${profileName()}: ${api.interactions.list().find((p) => p.id === api.presets.current()?.interaction)?.description || ''}`;

  // ---- reveal dot for hidden mode
  const reveal = button('•', () => S.set('ui.hidden', false), { cls: 'pr-reveal', title: 'SHOW CONTROLS' });

  // ---- sheet
  const sheetBody = el('div', { class: 'pr-sheet-body' });
  const sheet = el('div', { class: 'pr-sheet', role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Settings', hidden: true }, [
    el('div', { class: 'pr-sheet-head' }, [el('strong', { text: `${APP_NAME} SETTINGS` }), button('CLOSE', () => closeSheet(), { cls: 'pr-icon' })]),
    sheetBody,
  ]);
  let cleanups = [];
  const ss = { get: (k, d) => { try { return JSON.parse(sessionStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  function openSheet() {
    closeSheet(true);
    sheet.hidden = false; root.classList.add('sheet-open');
    const panels = api.ui.panels.list().slice().sort((a, b) => (a.order ?? 500) - (b.order ?? 500));
    const open = new Set(ss.get('pr-open', ['core.play']));
    for (const p of panels) {
      const body = el('div', { class: 'pr-panel-body' });
      const det = el('details', { class: 'pr-panel', ...(open.has(p.id) ? { open: true } : {}) }, [el('summary', { text: p.title }), body]);
      let rendered = false;
      const renderIt = () => {
        if (rendered) return; rendered = true;
        try { const c = p.render(body, api); if (typeof c === 'function') cleanups.push(c); }
        catch (err) { body.append(el('p', { class: 'pr-err', text: `PANEL ERROR: ${err.message}` })); console.warn(err); }
      };
      det.addEventListener('toggle', () => { if (det.open) { open.add(p.id); renderIt(); } else open.delete(p.id); ss.set('pr-open', [...open]); });
      if (det.open) renderIt();
      sheetBody.append(det);
    }
  }
  function closeSheet(silent) {
    for (const c of cleanups) { try { c(); } catch {} } cleanups = [];
    sheetBody.textContent = '';
    sheet.hidden = true; root.classList.remove('sheet-open');
    if (!silent) refresh();
  }

  // ---- toast + diagnostics
  const toastEl = el('div', { class: 'pr-toast', role: 'status' });
  let toastT = 0;
  function toast(text) { toastEl.textContent = text; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 2200); }
  const diag = el('pre', { class: 'pr-diag', hidden: true });
  let diagTimer = 0;
  function updateDiag() {
    const d = api.commands.diagnostics(); const p = d.perf;
    const failed = d.plugins.filter((x) => x.status === 'failed' || x.status === 'invalid').length;
    diag.textContent = `FPS ${p.fps}  ${p.frameMs}MS  DROPPED ${p.dropped}\nQUALITY ${p.quality.toUpperCase()}  GRID ${p.cols}×${p.rows}\nCELLS DRAWN ${p.cellsDrawn}  WORKLOAD ${p.workload}\nEFFECTS ${p.effects}  PARTICLES ${p.particles}\nVOICES ${p.voices}  CHAINS ${p.chains ?? 0}  JOBS ${p.scheduled}\nAUDIO ${String(d.audio).toUpperCase()}  RENDERER ${d.renderer}\nPLUGINS ${d.plugins.length} (${failed} FAILED)  UNDO ${d.history}\n${d.errors.slice(-2).map((e) => 'ERR ' + e.msg).join('\n')}`;
  }

  root.append(top, bottom, reveal, sheet, toastEl, diag);

  // ---- state refresh (labels always carry state as text)
  function refresh() {
    label.textContent = `${APP_NAME} · ${name()} · ${profileName()}${S.get('music.enabled') ? ` · ${S.get('music.tempo')} BPM` : ''}`;
    btnPlay.textContent = S.get('visual.animate') ? 'PAUSE' : 'PLAY';
    btnPlay.setAttribute('aria-pressed', String(!S.get('visual.animate')));
    const st = api.audio.state;
    btnSound.textContent = !S.get('audio.enabled') ? 'SOUND OFF' : st === 'unavailable' ? 'NO AUDIO' : st === 'running' ? 'SOUND ON' : 'SOUND (TAP)';
    btnSound.classList.toggle('is-on', S.get('audio.enabled') && st === 'running');
    btnSound.setAttribute('aria-pressed', String(!!S.get('audio.enabled')));
    btnUndo.disabled = api.commands.historyLength() === 0;
    const p = api.presets.current();
    if (p) {
      qPalette.textContent = `PALETTE: ${api.palettes.list().find((x) => x.id === p.palette)?.name || p.palette}`;
      qPattern.textContent = `PATTERN: ${api.patterns.list().find((x) => x.id === p.pattern.a.id)?.name || p.pattern.a.id}`;
      qEffect.textContent = `EFFECT: ${profileName()}`;
    }
    tempo.hidden = !S.get('music.enabled');
    tVal.textContent = `${S.get('music.tempo')} BPM`;
    root.classList.toggle('ui-hidden', !!S.get('ui.hidden'));
    root.classList.toggle('ui-large', !!S.get('a11y.largeUI'));
    document.documentElement.classList.toggle('reduced-motion', !!S.get('a11y.reducedMotion'));
    const dOn = !!S.get('perf.diagnostics');
    diag.hidden = !dOn;
    if (dOn && !diagTimer) { updateDiag(); diagTimer = setInterval(updateDiag, 300); }
    if (!dOn && diagTimer) { clearInterval(diagTimer); diagTimer = 0; }
  }

  // ---- dim while playing, wake on UI use
  let idleT = 0;
  const wake = () => { root.classList.remove('dim'); clearTimeout(idleT); idleT = setTimeout(() => root.classList.add('dim'), 3500); };
  root.addEventListener('pointerdown', wake);
  api.events.on('pointer:down', (p) => { if (!p.synthetic) root.classList.add('dim'); });

  for (const t of ['settings:changed', 'preset:applied', 'audio:state', 'history:changed', 'interaction:changed', 'renderer:changed']) api.events.on(t, refresh);
  api.events.on('ui:toast', (e) => toast(e.text));
  api.events.on('plugin:error', (e) => toast(`EXTENSION ERROR: ${e.id}`));
  api.events.on('preset:applied', (e) => { if (e.warnings?.length) console.info('[preset warnings]', e.warnings); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

  refresh(); wake();
  return { refresh, toast, openSheet, closeSheet };
}
