import { imageMime } from './core';

export interface CompressionOptions { enabled: boolean; quality: number; maxDimension: number }
export const DEFAULT_COMPRESSION: CompressionOptions = { enabled: true, quality: 0.9, maxDimension: 3200 };

export function scaledDimensions(width: number, height: number, maxDimension: number) {
  const ratio = maxDimension > 0 ? Math.min(1, maxDimension / Math.max(width, height)) : 1;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

function readBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onabort = () => reject(new Error('读取图片取消'));
    reader.readAsArrayBuffer(file);
  });
}

// Inspect chunk boundaries, rather than looking for strings in compressed pixels.
export function isAnimated(bytes: Uint8Array, mime: string): boolean {
  const text = (p: number) => String.fromCharCode(...bytes.subarray(p, p + 4));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === 'image/png') {
    for (let p = 8; p + 12 <= bytes.length;) {
      const length = view.getUint32(p);
      const kind = text(p + 4);
      if (kind === 'acTL') return true;
      if (kind === 'IDAT' || kind === 'IEND') return false;
      p += 12 + length;
    }
  } else if (mime === 'image/webp') {
    for (let p = 12; p + 8 <= bytes.length;) {
      const length = view.getUint32(p + 4, true);
      const kind = text(p);
      if (kind === 'ANIM' || kind === 'ANMF') return true;
      if (kind === 'VP8X' && length > 0 && p + 8 < bytes.length && (bytes[p + 8] & 2)) return true;
      p += 8 + length + (length % 2);
    }
  }
  return false;
}

export function keepSmaller(original: File, result: File): File {
  return result.size > 0 && result.size < original.size ? result : original;
}

/** Decode/encode failure safely retains the original. No network requests. */
export async function compressImage(file: File, options: CompressionOptions): Promise<File> {
  const mime = imageMime(file);
  if (!options.enabled || !mime || !['image/jpeg', 'image/png', 'image/webp', 'image/bmp'].includes(mime)) return file;
  let url: string | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let img: HTMLImageElement | undefined;
  try {
    if ((mime === 'image/png' || mime === 'image/webp') && isAnimated(await readBytes(file), mime)) return file;
    url = URL.createObjectURL(file);
    img = document.createElement('img');
    const decoded = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('图片解码超时')), 15000);
      img!.onload = () => { clearTimeout(timer); resolve(); };
      img!.onerror = () => { clearTimeout(timer); reject(new Error('图片解码失败')); };
    });
    img.src = url;
    await decoded;
    if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 80_000_000) return file;
    const size = scaledDimensions(img.naturalWidth, img.naturalHeight, options.maxDimension);
    canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(img, 0, 0, size.width, size.height);
    const outputMime = mime === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
    const quality = mime === 'image/png' ? Math.max(0.95, options.quality) : options.quality;
    const blob = await new Promise<Blob | null>(resolve => canvas!.toBlob(resolve, outputMime, quality));
    if (!blob || blob.type !== outputMime) return file;
    const name = file.name.replace(/\.[^.]+$/, '') + (outputMime === 'image/jpeg' ? '.jpg' : '.webp');
    return keepSmaller(file, new File([blob], name, { type: outputMime, lastModified: file.lastModified }));
  } catch {
    return file;
  } finally {
    if (url) URL.revokeObjectURL(url);
    if (img) { img.onload = null; img.onerror = null; img.src = ''; }
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
