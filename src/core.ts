const EXTENSIONS: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
};
const ALLOWED = new Set(Object.values(EXTENSIONS));
export const IMAGE_DATA_LINE_LENGTH = 4096;

export function imageMime(file: Pick<File, 'name' | 'type'>): string | null {
  const type = file.type.toLowerCase();
  if (ALLOWED.has(type)) return type;
  // Some file managers provide an empty or generic MIME type.
  if (type && type !== 'application/octet-stream') return null;
  return EXTENSIONS[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

export function validateFiles(files: File[], maxMiB: number): void {
  if (!files.length) throw new Error('没有可插入的图片。');
  for (const file of files) {
    if (!imageMime(file)) throw new Error(`不支持的图片格式：${file.name}`);
    if (!file.size) throw new Error(`图片是空文件：${file.name}`);
    if (file.size > maxMiB * 1024 * 1024) {
      throw new Error(`「${file.name}」超过单张 ${maxMiB} MB 的限制，可在插件设置中调整。`);
    }
  }
  if (files.reduce((n, f) => n + f.size, 0) > 40 * 1024 * 1024) {
    throw new Error('一次最多插入 40 MB 图片，请分批插入。');
  }
}

export function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`读取失败：${file.name}`));
    reader.onabort = () => reject(new Error(`读取取消：${file.name}`));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      const payload = result.slice(comma + 1);
      if (comma < 0 || !payload || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
        reject(new Error(`图片编码失败：${file.name}`));
        return;
      }
      resolve(`data:${imageMime(file)};base64,${payload}`);
    };
    reader.readAsDataURL(file);
  });
}

export function imageMarkdown(name: string, dataUrl: string): string {
  const alt = (name || '图片').replace(/[\\\[\]\r\n<>]/g, '_');
  const comma = dataUrl.indexOf(',');
  const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
  if (!ALLOWED.has(mime) || comma < 0) throw new Error('无效的内嵌图片');
  const payload = dataUrl.slice(comma + 1);
  const lines: string[] = [];
  for (let p = 0; p < payload.length; p += IMAGE_DATA_LINE_LENGTH) lines.push(payload.slice(p, p + IMAGE_DATA_LINE_LENGTH));
  return '```inline-image\n' + JSON.stringify({ name: alt, mime }) + '\n' + lines.join('\n') + '\n```';
}

export function parseImageBlock(source: string): { alt: string; url: string; width?: number } | null {
  const end = source.indexOf('\n');
  if (end < 0) return null;
  try {
    const metadata = JSON.parse(source.slice(0, end));
    if (typeof metadata.name !== 'string' || !ALLOWED.has(metadata.mime)) return null;
    const payload = source.slice(end + 1).replace(/\s/g, '');
    if (!payload || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return null;
    return { alt: metadata.name, url: `data:${metadata.mime};base64,${payload}`,
      width: typeof metadata.width === 'number' && Number.isFinite(metadata.width)
        ? Math.min(8192, Math.max(64, Math.round(metadata.width))) : undefined };
  } catch { return null; }
}

export async function encodeImages(files: File[], maxMiB: number,
  prepare?: (file: File) => Promise<File>): Promise<string> {
  validateFiles(files, maxMiB);
  const images: string[] = [];
  // Decode one at a time to avoid multiplying peak memory use.
  for (const original of files) {
    const file = prepare ? await prepare(original) : original;
    images.push(imageMarkdown(file.name, await readDataUrl(file)));
  }
  return images.join('\n\n');
}

// Match only base64 image destinations; never fold remote links or other data types.
export type ImageMatch = RegExpMatchArray & { width?: number };
export function* embeddedImages(text: string): Generator<ImageMatch> {
  const matches: ImageMatch[] = [];
  // The legacy alt matcher is linear and does not use nested ambiguous quantifiers.
  for (const match of text.matchAll(/!\[((?:[^\\\]\r\n]|\\.)*)\]\((data:image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2})\)/g)) matches.push(match);
  for (const match of text.matchAll(/^```inline-image\r?\n([^\n]*\n[A-Za-z0-9+/=\r\n]+)\r?\n```[ \t]*(?=\r?\n|$)/gm)) {
    const image = parseImageBlock(match[1]);
    if (!image) continue;
    const normalized = [match[0], image.alt, image.url] as ImageMatch;
    normalized.index = match.index;
    normalized.width = image.width;
    matches.push(normalized);
  }
  yield* matches.sort((a, b) => a.index! - b.index!);
}

/** A position disambiguates repeated copies of the same image. Never guess. */
export function imageDeletionRange(text: string, alt: string, url: string, near?: number) {
  const matches = [...embeddedImages(text)].filter(m => m[1] === alt && m[2] === url);
  const match = near === undefined ? (matches.length === 1 ? matches[0] : undefined)
    : matches.find(m => m.index! <= near && near <= m.index! + m[0].length);
  if (!match) return null;
  return { from: match.index!, to: match.index! + match[0].length };
}

/** Only edit the small metadata line, leaving all encoded bytes untouched. */
export function imageWidthChange(text: string, range: { from: number; to: number }, width?: number) {
  if (!text.startsWith('```inline-image', range.from)) return null;
  const from = text.indexOf('\n', range.from) + 1;
  const to = text.indexOf('\n', from);
  if (from <= range.from || to < from || to >= range.to) return null;
  try {
    const metadata = JSON.parse(text.slice(from, to));
    if (width === undefined) delete metadata.width;
    else {
      if (!Number.isFinite(width)) return null;
      metadata.width = Math.min(8192, Math.max(64, Math.round(width)));
    }
    return { from, to, insert: JSON.stringify(metadata) };
  } catch { return null; }
}

/** Fewer code lines reduce Markdown parser work. This never decodes or recompresses pixels. */
export function compactImageBlocks(text: string): { text: string; changed: number } {
  let changed = 0;
  const updated = text.replace(/^```inline-image\r?\n([^\n]*\n[A-Za-z0-9+/=\r\n]+)\r?\n```[ \t]*(?=\r?\n|$)/gm,
    (raw: string, source: string) => {
      if (!parseImageBlock(source)) return raw;
      const headerEnd = raw.indexOf('\n', raw.indexOf('\n') + 1) + 1;
      const closing = raw.lastIndexOf('\n```');
      const suffixFrom = raw[closing - 1] === '\r' ? closing - 1 : closing;
      const payload = raw.slice(headerEnd, suffixFrom).replace(/\s/g, '');
      const eol = raw.includes('\r\n') ? '\r\n' : '\n';
      const lines: string[] = [];
      for (let p = 0; p < payload.length; p += IMAGE_DATA_LINE_LENGTH) lines.push(payload.slice(p, p + IMAGE_DATA_LINE_LENGTH));
      const result = raw.slice(0, headerEnd) + lines.join(eol) + raw.slice(suffixFrom);
      if (result !== raw) changed++;
      return result;
    });
  return { text: updated, changed };
}
