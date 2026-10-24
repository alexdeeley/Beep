// EXAMPLE EXTENSION — accessibility: a colour-vision-safe palette (blue / orange / white,
// separated by luminance, not hue alone) and a one-tap toggle that switches to it and back.

export default {
  manifest: { id: 'ex.colour-safe', name: 'Colour-Safe Mode (example)', version: '1.0.0', type: 'accessibility', apiVersion: '1.0.0', description: 'Colour-vision-safe palette with a one-tap toggle.', dependencies: ['core.palettes'] },
  register(api) {
    // (see the ACCESSIBILITY FEATURES extension zone in src/ui/accessibility.js)
    api.palettes.register({ id: 'ex.colour-safe', name: 'COLOUR SAFE', stops: ['#0072b2', '#e69f00', '#ffffff', '#56b4e9'], white: 0.7, spread: 0.6, cycle: 0.008 });
    let previous = null;
    api.ui.panels.register({
      id: 'ex.colour-safe-panel', title: 'COLOUR-SAFE MODE (EXAMPLE)', order: 85,
      render(c, a) {
        const b = document.createElement('button'); b.className = 'pr-btn pr-toggle';
        const isOn = () => a.presets.current()?.palette === 'ex.colour-safe';
        const sync = () => { b.textContent = `COLOUR-SAFE PALETTE: ${isOn() ? 'ON' : 'OFF'}`; b.setAttribute('aria-pressed', String(isOn())); };
        b.onclick = () => {
          if (isOn()) a.palettes.setActive(previous && previous !== 'ex.colour-safe' ? previous : 'white-electric');
          else { previous = a.presets.current()?.palette; a.palettes.setActive('ex.colour-safe'); }
          sync();
        };
        sync(); c.append(b);
      },
    });
  },
};
