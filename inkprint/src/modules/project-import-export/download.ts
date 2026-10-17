/** Saves bytes as a file through a temporary object URL (revoked once the download has started). */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari needs the URL to stay alive a moment after the click.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function downloadBytes(bytes: Uint8Array, fileName: string, mime: string) {
  downloadBlob(new Blob([bytes], { type: mime }), fileName);
}

/** Share sheet with the file (AirDrop, Files, Mail...) where the browser supports sharing files. */
export async function shareFile(bytes: Uint8Array, fileName: string, mime: string): Promise<'shared' | 'unsupported' | 'cancelled'> {
  const file = new File([bytes], fileName, { type: mime });
  const nav = navigator as Navigator & { canShare?(d: ShareData): boolean };
  if (!nav.share || !nav.canShare?.({ files: [file] })) return 'unsupported';
  try {
    await nav.share({ files: [file], title: fileName });
    return 'shared';
  } catch {
    return 'cancelled';
  }
}
