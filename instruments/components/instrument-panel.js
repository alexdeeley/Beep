// A single instrument's window inside the workspace: header (drag handle,
// name, mute/solo/remove), the instrument's own mounted UI, and a
// collapsible per-instrument effects strip. Dragging only ever happens via
// the header/handle - the instrument body is untouched so pointer events
// inside it always mean "play the instrument", never "move the window".
//
// Audio routing for this panel: instance output -> gainNode (volume/mute/
// solo) -> masterBus. The panel owns gainNode; the workspace/mixer decides
// solo policy across panels and calls applyGain() to tell this panel
// whether it should be silent regardless of its own mute state.

const MIN_PANEL_WIDTH = 220;
const MIN_PANEL_HEIGHT = 220;

export function createPanel(opts) {
  const { instanceId, instrumentId, manifest, instance, ctx, masterBus, onFocus, onRemove } = opts;

  const gainNode = ctx.createGain();
  let mountError = null;
  try {
    instance.getAudioOutput().connect(gainNode);
  } catch (e) {
    mountError = e;
  }
  gainNode.connect(masterBus);

  let x = opts.x ?? 20;
  let y = opts.y ?? 20;
  let width = Math.max(manifest.minimumWidth || MIN_PANEL_WIDTH, opts.width ?? manifest.defaultWidth ?? 360);
  let height = Math.max(manifest.minimumHeight || MIN_PANEL_HEIGHT, opts.height ?? manifest.defaultHeight ?? 400);
  let volume = opts.volume ?? 0.8;
  let muted = !!opts.muted;
  let solo = !!opts.solo;
  let effectsState = { distortion: 0, delay: 0, reverb: 0, ...(opts.effects || {}) };
  let effectsOpen = false;

  const el = document.createElement("div");
  el.className = "im-panel";
  el.dataset.instanceId = instanceId;

  const header = document.createElement("div");
  header.className = "im-panel-header";

  const title = document.createElement("span");
  title.className = "im-panel-title";
  title.textContent = (manifest.icon ? manifest.icon + " " : "") + manifest.shortName;
  header.appendChild(title);

  const spacer = document.createElement("span");
  spacer.className = "im-panel-spacer";
  header.appendChild(spacer);

  const muteBtn = document.createElement("button");
  muteBtn.className = "im-panel-btn im-panel-mute";
  muteBtn.type = "button";
  muteBtn.textContent = "M";
  muteBtn.title = "Mute";
  muteBtn.addEventListener("click", () => {
    muted = !muted;
    muteBtn.classList.toggle("im-panel-btn-active", muted);
    applyGain();
  });
  header.appendChild(muteBtn);

  const soloBtn = document.createElement("button");
  soloBtn.className = "im-panel-btn im-panel-solo";
  soloBtn.type = "button";
  soloBtn.textContent = "S";
  soloBtn.title = "Solo";
  soloBtn.addEventListener("click", () => {
    solo = !solo;
    soloBtn.classList.toggle("im-panel-btn-active", solo);
    opts.onSoloChange?.();
  });
  header.appendChild(soloBtn);

  const hasEffects = manifest.supportsEffects !== false;
  let fxBtn = null;
  if (hasEffects) {
    fxBtn = document.createElement("button");
    fxBtn.className = "im-panel-btn im-panel-fx";
    fxBtn.type = "button";
    fxBtn.textContent = "FX";
    fxBtn.title = "Effects";
    fxBtn.addEventListener("click", () => {
      effectsOpen = !effectsOpen;
      fxBtn.classList.toggle("im-panel-btn-active", effectsOpen);
      effectsPanel.style.display = effectsOpen ? "flex" : "none";
    });
    header.appendChild(fxBtn);
  }

  const removeBtn = document.createElement("button");
  removeBtn.className = "im-panel-btn im-panel-remove";
  removeBtn.type = "button";
  removeBtn.textContent = "×";
  removeBtn.title = "Remove";
  removeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    onRemove?.(instanceId);
  });
  header.appendChild(removeBtn);

  el.appendChild(header);

  const volumeRow = document.createElement("div");
  volumeRow.className = "im-panel-volume-row";
  const volumeSlider = document.createElement("input");
  volumeSlider.type = "range";
  volumeSlider.min = "0";
  volumeSlider.max = "100";
  volumeSlider.value = String(Math.round(volume * 100));
  volumeSlider.className = "im-panel-volume";
  volumeSlider.addEventListener("input", () => {
    volume = Number(volumeSlider.value) / 100;
    applyGain();
  });
  volumeRow.appendChild(volumeSlider);
  el.appendChild(volumeRow);

  const body = document.createElement("div");
  body.className = "im-panel-body";
  el.appendChild(body);

  const errorBox = document.createElement("div");
  errorBox.className = "im-panel-error";
  errorBox.style.display = "none";
  errorBox.innerHTML = '<strong>This instrument failed to load.</strong><br>Try removing and re-adding it.';
  el.appendChild(errorBox);

  let effectsPanel = null;
  if (hasEffects) {
    effectsPanel = document.createElement("div");
    effectsPanel.className = "im-panel-effects";
    effectsPanel.style.display = "none";
    el.appendChild(effectsPanel);

    const buildEffectRow = (kind, label) => {
      const row = document.createElement("div");
      row.className = "im-fx-row";
      const rowLabel = document.createElement("span");
      rowLabel.className = "im-fx-label";
      rowLabel.textContent = label;
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "100";
      slider.value = String(Math.round((effectsState[kind] || 0) * 100));
      slider.addEventListener("input", () => {
        const amt = Number(slider.value) / 100;
        effectsState[kind] = amt;
        safeSetEffect(kind, amt);
      });
      row.appendChild(rowLabel);
      row.appendChild(slider);
      effectsPanel.appendChild(row);
    };
    buildEffectRow("distortion", "Drive");
    buildEffectRow("delay", "Delay");
    buildEffectRow("reverb", "Reverb");
  }

  const resizeHandle = document.createElement("div");
  resizeHandle.className = "im-panel-resize";
  el.appendChild(resizeHandle);

  function safeSetEffect(kind, amt) {
    try {
      instance.setEffectAmount(kind, amt);
    } catch (e) {}
  }

  function applyPosition() {
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.width = width + "px";
    el.style.height = height + "px";
  }

  function applyGain(effectiveSilence) {
    const silent = effectiveSilence ?? el.dataset.forcedSilent === "1";
    if (effectiveSilence !== undefined) el.dataset.forcedSilent = effectiveSilence ? "1" : "0";
    const target = muted || silent ? 0 : volume;
    gainNode.gain.setTargetAtTime(target, ctx.currentTime, 0.01);
  }

  // Dragging: header only. Resizing: the corner handle only. Both use
  // Pointer Events + pointer capture so a single finger/mouse can drag
  // fluidly and multiple panels can be manipulated by different pointers
  // at once without interfering with each other.
  let drag = null;
  header.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".im-panel-btn")) return;
    onFocus?.(instanceId);
    header.setPointerCapture(e.pointerId);
    drag = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origX: x, origY: y };
    e.preventDefault();
  });
  header.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    x = drag.origX + (e.clientX - drag.startX);
    y = drag.origY + (e.clientY - drag.startY);
    applyPosition();
  });
  function endDrag(e) {
    if (drag && e.pointerId === drag.pointerId) {
      try { header.releasePointerCapture(e.pointerId); } catch (err) {}
      drag = null;
      opts.onGeometryChange?.();
    }
  }
  header.addEventListener("pointerup", endDrag);
  header.addEventListener("pointercancel", endDrag);

  let resize = null;
  resizeHandle.addEventListener("pointerdown", (e) => {
    onFocus?.(instanceId);
    resizeHandle.setPointerCapture(e.pointerId);
    resize = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origW: width, origH: height };
    e.preventDefault();
    e.stopPropagation();
  });
  resizeHandle.addEventListener("pointermove", (e) => {
    if (!resize || e.pointerId !== resize.pointerId) return;
    const minW = manifest.minimumWidth || MIN_PANEL_WIDTH;
    const minH = manifest.minimumHeight || MIN_PANEL_HEIGHT;
    width = Math.max(minW, resize.origW + (e.clientX - resize.startX));
    height = Math.max(minH, resize.origH + (e.clientY - resize.startY));
    applyPosition();
  });
  function endResize(e) {
    if (resize && e.pointerId === resize.pointerId) {
      try { resizeHandle.releasePointerCapture(e.pointerId); } catch (err) {}
      resize = null;
      opts.onGeometryChange?.();
    }
  }
  resizeHandle.addEventListener("pointerup", endResize);
  resizeHandle.addEventListener("pointercancel", endResize);

  el.addEventListener("pointerdown", () => onFocus?.(instanceId));

  applyPosition();
  applyGain(false);
  muteBtn.classList.toggle("im-panel-btn-active", muted);
  soloBtn.classList.toggle("im-panel-btn-active", solo);
  for (const [kind, amt] of Object.entries(effectsState)) safeSetEffect(kind, amt);

  if (mountError) {
    errorBox.style.display = "block";
    body.style.display = "none";
  } else {
    try {
      instance.mount(body);
    } catch (e) {
      mountError = e;
      errorBox.style.display = "block";
      body.style.display = "none";
    }
  }

  return {
    el,
    instanceId,
    instrumentId,
    isSolo: () => solo,
    setForcedSilent: (silent) => applyGain(silent),
    setZIndex(z) {
      el.style.zIndex = String(z);
    },
    getGeometry() {
      return { x, y, width, height };
    },
    setGeometry(next) {
      if (next.x !== undefined) x = next.x;
      if (next.y !== undefined) y = next.y;
      if (next.width !== undefined) width = Math.max(manifest.minimumWidth || MIN_PANEL_WIDTH, next.width);
      if (next.height !== undefined) height = Math.max(manifest.minimumHeight || MIN_PANEL_HEIGHT, next.height);
      applyPosition();
    },
    restoreInstrumentState(state) {
      if (mountError || !state) return;
      try {
        instance.restore(state);
      } catch (e) {}
    },
    start() {
      if (mountError) return;
      try {
        instance.start();
      } catch (e) {}
    },
    stop() {
      try {
        instance.stop();
      } catch (e) {}
    },
    serialize() {
      let instrumentState = null;
      try {
        instrumentState = mountError ? null : instance.serialize();
      } catch (e) {}
      return { instanceId, instrumentId, x, y, width, height, volume, muted, solo, effects: { ...effectsState }, instrumentState };
    },
    dispose() {
      try {
        this.stop();
      } catch (e) {}
      try {
        if (!mountError) instance.unmount();
      } catch (e) {}
      try {
        instance.dispose();
      } catch (e) {}
      try {
        gainNode.disconnect();
      } catch (e) {}
      el.remove();
    },
  };
}
