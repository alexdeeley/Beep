// Tiny shared builder for the "label + slider + live value" rows used by
// every custom-UI instrument (Orbit, Bloom, Scatter, Rain, Motor, Crater,
// ...) so each one doesn't hand-roll the same three DOM nodes.
export function buildParamRow(container, { label, min = 0, max = 100, step = 1, value, format, onInput }) {
  const row = document.createElement("div");
  row.className = "im-param-row";

  const lbl = document.createElement("span");
  lbl.className = "im-param-label";
  lbl.textContent = label;
  row.appendChild(lbl);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(value);
  row.appendChild(slider);

  const fmt = format || ((v) => String(v));
  const valueEl = document.createElement("span");
  valueEl.className = "im-param-value";
  valueEl.textContent = fmt(Number(slider.value));
  row.appendChild(valueEl);

  slider.addEventListener("input", () => {
    const v = Number(slider.value);
    valueEl.textContent = fmt(v);
    onInput(v);
  });

  container.appendChild(row);
  return {
    slider,
    setValue(v) {
      slider.value = String(v);
      valueEl.textContent = fmt(v);
    },
  };
}
