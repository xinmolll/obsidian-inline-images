interface Entry { url: string; refs: number; revoke: () => void }
const caches = new Map<Document, Map<string, Entry>>();
const originals = new WeakMap<HTMLImageElement, string>();

/** The complete data stays in Markdown; only a short Blob URL is put in the DOM. */
export function bindImageSource(image: HTMLImageElement, dataUrl: string): () => void {
  originals.set(image, dataUrl);
  image.decoding = 'async';
  const doc = image.ownerDocument, win = doc.defaultView;
  if (!win || typeof win.URL.createObjectURL !== 'function') {
    image.src = dataUrl;
    return () => { originals.delete(image); };
  }
  let cache = caches.get(doc);
  if (!cache) { cache = new Map(); caches.set(doc, cache); }
  let entry = cache.get(dataUrl);
  if (!entry) {
    try {
      const comma = dataUrl.indexOf(',');
      const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
      const binary = win.atob(dataUrl.slice(comma + 1));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const url = win.URL.createObjectURL(new win.Blob([bytes], { type: mime }));
      let revoked = false;
      entry = { url, refs: 0, revoke: () => {
        if (!revoked) { revoked = true; win.URL.revokeObjectURL(url); }
      } };
      cache.set(dataUrl, entry);
    } catch {
      if (!cache.size) caches.delete(doc);
      image.src = dataUrl;
      return () => { originals.delete(image); };
    }
  }
  entry.refs++;
  image.src = entry.url;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    originals.delete(image);
    entry!.refs--;
    if (entry!.refs === 0) {
      entry!.revoke();
      cache!.delete(dataUrl);
      if (!cache!.size && caches.get(doc) === cache) caches.delete(doc);
    }
  };
}

export function originalImageSource(image: HTMLImageElement): string {
  return originals.get(image) || image.currentSrc || image.src;
}

export function clearImageSources() {
  for (const cache of caches.values()) for (const entry of cache.values()) entry.revoke();
  caches.clear();
}
