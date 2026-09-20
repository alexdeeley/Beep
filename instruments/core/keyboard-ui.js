// Shared on-screen piano-style keyboard: white/black key layout plus
// robust multi-touch pointer handling (capture-per-pointerId so chords
// work). Reused by any instrument played as notes on a keyboard (Piano,
// Accordion, ...) - this module only turns pointer gestures into
// onNoteOn/onNoteOff calls, the caller owns note synthesis entirely.
export const WHITE_KEY_WIDTH = 36;
export const BLACK_KEY_WIDTH = 22;
const SEMITONE_IS_BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
const NOTE_LETTERS = ["C", "", "D", "", "E", "F", "", "G", "", "A", "", "B"];

export function buildKeyboardModel(octaves, octaveLabelBase = 3) {
  const keys = [];
  let whiteIndex = 0;
  for (let o = 0; o < octaves; o++) {
    for (let s = 0; s < 12; s++) {
      const semitone = o * 12 + s;
      const isBlack = SEMITONE_IS_BLACK[s];
      if (isBlack) {
        keys.push({ semitone, isBlack: true, left: whiteIndex * WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2 });
      } else {
        keys.push({ semitone, isBlack: false, whiteIndex, label: NOTE_LETTERS[s] === "C" ? "C" + (o + octaveLabelBase) : "" });
        whiteIndex++;
      }
    }
  }
  return { keys, whiteCount: whiteIndex };
}

// onNoteOn(semitone) must return a voiceId; onNoteOff(voiceId) releases it.
// keyClassPrefix defaults to the piano's own key classes so any keyboard
// instrument gets identical look and feel for free without new CSS.
export function createKeyboardUI({ octaves, keyClassPrefix = "im-piano-key", onNoteOn, onNoteOff }) {
  const keysWrap = document.createElement("div");
  keysWrap.className = keyClassPrefix + "s";
  const { keys, whiteCount } = buildKeyboardModel(octaves);
  keysWrap.style.width = whiteCount * WHITE_KEY_WIDTH + "px";

  const pointerVoices = new Map();

  function release(e) {
    const entry = pointerVoices.get(e.pointerId);
    if (!entry) return;
    entry.el.classList.remove(keyClassPrefix + "-active");
    onNoteOff(entry.voiceId);
    pointerVoices.delete(e.pointerId);
  }

  for (const key of keys) {
    const el = document.createElement("div");
    el.dataset.semitone = String(key.semitone);
    if (key.isBlack) {
      el.className = keyClassPrefix + " " + keyClassPrefix + "-black";
      el.style.left = key.left + "px";
    } else {
      el.className = keyClassPrefix + " " + keyClassPrefix + "-white";
      if (key.label) {
        const label = document.createElement("span");
        label.className = keyClassPrefix + "-label";
        label.textContent = key.label;
        el.appendChild(label);
      }
    }
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch (err) {}
      el.classList.add(keyClassPrefix + "-active");
      const voiceId = onNoteOn(key.semitone);
      pointerVoices.set(e.pointerId, { voiceId, el });
    });
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("pointerleave", (e) => {
      // Leaving the key while still pressed (a real sliding-finger risk on
      // a compact on-screen keyboard) should still release that note -
      // pointer capture keeps the up/cancel events routed here regardless.
      if (pointerVoices.has(e.pointerId) && e.buttons === 0) release(e);
    });
    keysWrap.appendChild(el);
  }

  return {
    el: keysWrap,
    dispose() {
      pointerVoices.clear();
    },
  };
}
