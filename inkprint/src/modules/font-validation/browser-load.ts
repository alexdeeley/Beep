/**
 * Loads font bytes into the page with the FontFace API. This runs the
 * browser's own font sanitizer (OTS in Chrome and Firefox, Core Text in
 * Safari), so a font that loads here is one real software accepts.
 */
let serial = 0;

export interface LoadedFont {
  family: string;
  face: FontFace;
  dispose(): void;
}

export async function loadFontInBrowser(bytes: Uint8Array, prefix = 'InkprintPreview'): Promise<LoadedFont> {
  const family = `${prefix}-${++serial}-${Date.now().toString(36)}`;
  const copy = bytes.slice().buffer;
  const face = new FontFace(family, copy);
  await face.load();
  document.fonts.add(face);
  return {
    family,
    face,
    dispose() {
      document.fonts.delete(face);
    },
  };
}
