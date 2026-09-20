// A single instrument's cell inside a workspace quadrant: header (name,
// mute/solo/fx/remove), the instrument's own mounted UI, and a
// collapsible per-instrument effects strip. The panel fills whatever
// quadrant it's placed in - it has no position or size of its own, so
// there's nothing to drag or resize; the only thing pointer events inside
// the body ever mean is "play the instrument".
//
// Audio routing for this panel: instance output -> gainNode (volume/mute/
// solo) -> masterBus. The panel owns gainNode; the workspace/mixer decides
// solo policy across panels and calls setForcedSilent() to tell this panel
// whether it should be silent regardless of its own mute state.

export function createPanel(opts) {
  const { instanceId, instrumentId, manifest, instance, ctx, masterBus, onRemove, onChange } = opts;

  const gainNode = ctx.createGain();
  let mountError = null;
  try {
    instance.getAudioOutput().connect(gainNode);
  } catch (e) {
    mountError = e;
  }
  const panNode = ctx.createStereoPanner();
  panNode.pan.value = opts.pan ?? 0;
  gainNode.connect(panNode);
  panNode.connect(masterBus);

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
    onChange?.();
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
  volumeSlider.title = "Volume";
  volumeSlider.addEventListener("input", () => {
    volume = Number(volumeSlider.value) / 100;
    applyGain();
    onChange?.();
  });
  volumeRow.appendChild(volumeSlider);

  const panSlider = document.createElement("input");
  panSlider.type = "range";
  panSlider.min = "-100";
  panSlider.max = "100";
  panSlider.value = String(Math.round(panNode.pan.value * 100));
  panSlider.className = "im-panel-pan";
  panSlider.title = "Pan";
  panSlider.addEventListener("input", () => {
    panNode.pan.setTargetAtTime(Number(panSlider.value) / 100, ctx.currentTime, 0.01);
    onChange?.();
  });
  volumeRow.appendChild(panSlider);

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
        onChange?.();
      });
      row.appendChild(rowLabel);
      row.appendChild(slider);
      effectsPanel.appendChild(row);
    };
    buildEffectRow("distortion", "Drive");
    buildEffectRow("delay", "Delay");
    buildEffectRow("reverb", "Reverb");
  }

  function safeSetEffect(kind, amt) {
    try {
      instance.setEffectAmount(kind, amt);
    } catch (e) {}
  }

  function applyGain(effectiveSilence) {
    const silent = effectiveSilence ?? el.dataset.forcedSilent === "1";
    if (effectiveSilence !== undefined) el.dataset.forcedSilent = effectiveSilence ? "1" : "0";
    const target = muted || silent ? 0 : volume;
    gainNode.gain.setTargetAtTime(target, ctx.currentTime, 0.01);
  }

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
      return { instanceId, instrumentId, volume, muted, solo, pan: panNode.pan.value, effects: { ...effectsState }, instrumentState };
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
        panNode.disconnect();
      } catch (e) {}
      el.remove();
    },
  };
}
