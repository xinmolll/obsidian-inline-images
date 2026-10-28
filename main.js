/* 图片存进笔记 v1.6.0 | MIT License */
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => InlineImages
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var import_view2 = require("@codemirror/view");

// src/core.ts
var EXTENSIONS = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml"
};
var ALLOWED = new Set(Object.values(EXTENSIONS));
var IMAGE_DATA_LINE_LENGTH = 4096;
function imageMime(file) {
  const type = file.type.toLowerCase();
  if (ALLOWED.has(type)) return type;
  if (type && type !== "application/octet-stream") return null;
  return EXTENSIONS[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}
function validateFiles(files, maxMiB) {
  if (!files.length) throw new Error("\u6CA1\u6709\u53EF\u63D2\u5165\u7684\u56FE\u7247\u3002");
  for (const file of files) {
    if (!imageMime(file)) throw new Error(`\u4E0D\u652F\u6301\u7684\u56FE\u7247\u683C\u5F0F\uFF1A${file.name}`);
    if (!file.size) throw new Error(`\u56FE\u7247\u662F\u7A7A\u6587\u4EF6\uFF1A${file.name}`);
    if (file.size > maxMiB * 1024 * 1024) {
      throw new Error(`\u300C${file.name}\u300D\u8D85\u8FC7\u5355\u5F20 ${maxMiB} MB \u7684\u9650\u5236\uFF0C\u53EF\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u8C03\u6574\u3002`);
    }
  }
  if (files.reduce((n, f) => n + f.size, 0) > 40 * 1024 * 1024) {
    throw new Error("\u4E00\u6B21\u6700\u591A\u63D2\u5165 40 MB \u56FE\u7247\uFF0C\u8BF7\u5206\u6279\u63D2\u5165\u3002");
  }
}
function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`\u8BFB\u53D6\u5931\u8D25\uFF1A${file.name}`));
    reader.onabort = () => reject(new Error(`\u8BFB\u53D6\u53D6\u6D88\uFF1A${file.name}`));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      const payload = result.slice(comma + 1);
      if (comma < 0 || !payload || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
        reject(new Error(`\u56FE\u7247\u7F16\u7801\u5931\u8D25\uFF1A${file.name}`));
        return;
      }
      resolve(`data:${imageMime(file)};base64,${payload}`);
    };
    reader.readAsDataURL(file);
  });
}
function imageMarkdown(name, dataUrl) {
  const alt = (name || "\u56FE\u7247").replace(/[\\\[\]\r\n<>]/g, "_");
  const comma = dataUrl.indexOf(",");
  const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
  if (!ALLOWED.has(mime) || comma < 0) throw new Error("\u65E0\u6548\u7684\u5185\u5D4C\u56FE\u7247");
  const payload = dataUrl.slice(comma + 1);
  const lines = [];
  for (let p = 0; p < payload.length; p += IMAGE_DATA_LINE_LENGTH) lines.push(payload.slice(p, p + IMAGE_DATA_LINE_LENGTH));
  return "```inline-image\n" + JSON.stringify({ name: alt, mime }) + "\n" + lines.join("\n") + "\n```";
}
function parseImageBlock(source) {
  const end = source.indexOf("\n");
  if (end < 0) return null;
  try {
    const metadata = JSON.parse(source.slice(0, end));
    if (typeof metadata.name !== "string" || !ALLOWED.has(metadata.mime)) return null;
    const payload = source.slice(end + 1).replace(/\s/g, "");
    if (!payload || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return null;
    return {
      alt: metadata.name,
      url: `data:${metadata.mime};base64,${payload}`,
      width: typeof metadata.width === "number" && Number.isFinite(metadata.width) ? Math.min(8192, Math.max(64, Math.round(metadata.width))) : void 0
    };
  } catch {
    return null;
  }
}
async function encodeImages(files, maxMiB, prepare) {
  validateFiles(files, maxMiB);
  const images = [];
  for (const original of files) {
    const file = prepare ? await prepare(original) : original;
    images.push(imageMarkdown(file.name, await readDataUrl(file)));
  }
  return images.join("\n\n");
}
function* embeddedImages(text) {
  const matches = [];
  for (const match of text.matchAll(/!\[((?:[^\\\]\r\n]|\\.)*)\]\((data:image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2})\)/g)) matches.push(match);
  for (const match of text.matchAll(/^```inline-image\r?\n([^\n]*\n[A-Za-z0-9+/=\r\n]+)\r?\n```[ \t]*(?=\r?\n|$)/gm)) {
    const image = parseImageBlock(match[1]);
    if (!image) continue;
    const normalized = [match[0], image.alt, image.url];
    normalized.index = match.index;
    normalized.width = image.width;
    matches.push(normalized);
  }
  yield* matches.sort((a, b) => a.index - b.index);
}
function imageDeletionRange(text, alt, url, near) {
  const matches = [...embeddedImages(text)].filter((m) => m[1] === alt && m[2] === url);
  const match = near === void 0 ? matches.length === 1 ? matches[0] : void 0 : matches.find((m) => m.index <= near && near <= m.index + m[0].length);
  if (!match) return null;
  return { from: match.index, to: match.index + match[0].length };
}
function imageWidthChange(text, range, width) {
  if (!text.startsWith("```inline-image", range.from)) return null;
  const from = text.indexOf("\n", range.from) + 1;
  const to = text.indexOf("\n", from);
  if (from <= range.from || to < from || to >= range.to) return null;
  try {
    const metadata = JSON.parse(text.slice(from, to));
    if (width === void 0) delete metadata.width;
    else {
      if (!Number.isFinite(width)) return null;
      metadata.width = Math.min(8192, Math.max(64, Math.round(width)));
    }
    return { from, to, insert: JSON.stringify(metadata) };
  } catch {
    return null;
  }
}
function compactImageBlocks(text) {
  let changed = 0;
  const updated = text.replace(
    /^```inline-image\r?\n([^\n]*\n[A-Za-z0-9+/=\r\n]+)\r?\n```[ \t]*(?=\r?\n|$)/gm,
    (raw, source) => {
      if (!parseImageBlock(source)) return raw;
      const headerEnd = raw.indexOf("\n", raw.indexOf("\n") + 1) + 1;
      const closing = raw.lastIndexOf("\n```");
      const suffixFrom = raw[closing - 1] === "\r" ? closing - 1 : closing;
      const payload = raw.slice(headerEnd, suffixFrom).replace(/\s/g, "");
      const eol = raw.includes("\r\n") ? "\r\n" : "\n";
      const lines = [];
      for (let p = 0; p < payload.length; p += IMAGE_DATA_LINE_LENGTH) lines.push(payload.slice(p, p + IMAGE_DATA_LINE_LENGTH));
      const result = raw.slice(0, headerEnd) + lines.join(eol) + raw.slice(suffixFrom);
      if (result !== raw) changed++;
      return result;
    }
  );
  return { text: updated, changed };
}

// src/preview.ts
var import_state = require("@codemirror/state");
var import_view = require("@codemirror/view");
var import_language = require("@codemirror/language");

// src/zoom.ts
var activeZooms = /* @__PURE__ */ new Map();
function closeImageZooms() {
  for (const close of [...activeZooms.values()]) close();
}
function openImageZoom(original) {
  const doc = original.ownerDocument;
  const win = doc.defaultView;
  if (!win) return;
  activeZooms.get(doc)?.();
  const previousFocus = doc.activeElement;
  const overlay = doc.createElement("div");
  overlay.className = "inline-images-lightbox";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", `\u56FE\u7247\u653E\u5927\u9884\u89C8\uFF1A${original.alt || "\u56FE\u7247"}`);
  const image = doc.createElement("img");
  image.className = "inline-images-lightbox-image";
  image.alt = original.alt;
  image.draggable = false;
  const closeButton = doc.createElement("button");
  closeButton.type = "button";
  closeButton.className = "inline-images-lightbox-close";
  closeButton.textContent = "\u5173\u95ED \xD7";
  closeButton.setAttribute("aria-label", "\u5173\u95ED\u56FE\u7247\u9884\u89C8");
  const caption = doc.createElement("div");
  caption.className = "inline-images-lightbox-caption";
  caption.textContent = original.alt;
  const fit = () => {
    const width = image.naturalWidth || original.naturalWidth;
    const height = image.naturalHeight || original.naturalHeight;
    if (!width || !height) return;
    const scale = Math.min(
      Math.max(1, win.innerWidth - 48) / width,
      Math.max(1, win.innerHeight - 120) / height
    );
    image.style.width = `${Math.max(1, Math.round(width * scale))}px`;
    image.style.height = `${Math.max(1, Math.round(height * scale))}px`;
  };
  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      event.preventDefault();
      closeButton.focus();
    }
  };
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    doc.removeEventListener("keydown", onKey, true);
    win.removeEventListener("resize", fit);
    overlay.remove();
    image.removeAttribute("src");
    activeZooms.delete(doc);
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
  activeZooms.set(doc, close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });
  closeButton.addEventListener("click", close);
  image.addEventListener("load", fit);
  overlay.append(image, closeButton, caption);
  doc.body.append(overlay);
  doc.addEventListener("keydown", onKey, true);
  win.addEventListener("resize", fit);
  image.src = original.currentSrc || original.src;
  fit();
  closeButton.focus();
}
function attachImageZoom(image, onDragStart) {
  image.classList.add("inline-images-zoomable");
  image.title = onDragStart ? "\u62D6\u52A8\u8C03\u6574\u56FE\u7247\u4F4D\u7F6E\uFF1B\u53CC\u51FB\u653E\u5927" : "\u53CC\u51FB\u653E\u5927\u56FE\u7247";
  image.draggable = Boolean(onDragStart);
  image.tabIndex = 0;
  image.addEventListener("mousedown", (event) => {
    event.stopPropagation();
  });
  if (onDragStart) image.addEventListener("dragstart", onDragStart);
  image.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  image.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openImageZoom(image);
  });
  image.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      openImageZoom(image);
    }
  });
}

// src/resize.ts
var activeResizes = /* @__PURE__ */ new Set();
function cancelImageResizes() {
  for (const cancel of [...activeResizes]) cancel();
}
function attachImageResize(image, frame, width, begin, measure) {
  const doc = frame.ownerDocument;
  if (width !== void 0) {
    image.style.width = `${width}px`;
    image.classList.add("inline-images-user-sized");
  }
  const handle = doc.createElement("button");
  handle.type = "button";
  handle.className = "inline-images-resize";
  handle.title = "\u62D6\u52A8\u8C03\u6574\u56FE\u7247\u5927\u5C0F\uFF1B\u53CC\u51FB\u6062\u590D\u81EA\u52A8\u5927\u5C0F";
  handle.setAttribute("aria-label", "\u8C03\u6574\u56FE\u7247\u5927\u5C0F");
  handle.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  handle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  handle.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const commit = begin();
    if (commit) void commit(void 0);
  });
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const commit = begin();
    if (!commit) return;
    const initialRect = image.getBoundingClientRect();
    const initialWidth = initialRect.width;
    const aspect = initialRect.height > 0 ? initialWidth / initialRect.height : 1;
    const maxWidth = Math.max(64, frame.parentElement?.clientWidth || initialWidth);
    const oldStyle = image.style.width;
    const hadSize = image.classList.contains("inline-images-user-sized");
    const startX = event.clientX;
    const startY = event.clientY;
    let latest = initialWidth;
    let changed = false;
    const cleanup = () => {
      doc.removeEventListener("pointermove", move, true);
      doc.removeEventListener("pointerup", finish, true);
      doc.removeEventListener("pointercancel", cancel, true);
      activeResizes.delete(cancel);
      frame.classList.remove("is-resizing");
    };
    const cancel = () => {
      cleanup();
      image.style.width = oldStyle;
      image.classList.toggle("inline-images-user-sized", hadSize);
      measure?.();
    };
    const move = (next) => {
      if (next.pointerId !== event.pointerId) return;
      next.preventDefault();
      next.stopPropagation();
      const dx = next.clientX - startX, dy = next.clientY - startY;
      const delta = Math.abs(dx) >= Math.abs(dy * aspect) ? dx : dy * aspect;
      latest = Math.round(Math.min(maxWidth, Math.max(64, initialWidth + delta)));
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 2 && !changed) return;
      changed = true;
      image.classList.add("inline-images-user-sized");
      image.style.width = `${latest}px`;
      measure?.();
    };
    const finish = (next) => {
      if (next.pointerId !== event.pointerId) return;
      next.preventDefault();
      next.stopPropagation();
      cleanup();
      if (changed) void commit(latest);
    };
    frame.classList.add("is-resizing");
    activeResizes.add(cancel);
    doc.addEventListener("pointermove", move, true);
    doc.addEventListener("pointerup", finish, true);
    doc.addEventListener("pointercancel", cancel, true);
  });
  frame.append(handle);
}

// src/image-source.ts
var caches = /* @__PURE__ */ new Map();
var originals = /* @__PURE__ */ new WeakMap();
function bindImageSource(image, dataUrl) {
  originals.set(image, dataUrl);
  image.decoding = "async";
  const doc = image.ownerDocument, win = doc.defaultView;
  if (!win || typeof win.URL.createObjectURL !== "function") {
    image.src = dataUrl;
    return () => {
      originals.delete(image);
    };
  }
  let cache = caches.get(doc);
  if (!cache) {
    cache = /* @__PURE__ */ new Map();
    caches.set(doc, cache);
  }
  let entry = cache.get(dataUrl);
  if (!entry) {
    try {
      const comma = dataUrl.indexOf(",");
      const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
      const binary = win.atob(dataUrl.slice(comma + 1));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const url = win.URL.createObjectURL(new win.Blob([bytes], { type: mime }));
      let revoked = false;
      entry = { url, refs: 0, revoke: () => {
        if (!revoked) {
          revoked = true;
          win.URL.revokeObjectURL(url);
        }
      } };
      cache.set(dataUrl, entry);
    } catch {
      if (!cache.size) caches.delete(doc);
      image.src = dataUrl;
      return () => {
        originals.delete(image);
      };
    }
  }
  entry.refs++;
  image.src = entry.url;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    originals.delete(image);
    entry.refs--;
    if (entry.refs === 0) {
      entry.revoke();
      cache.delete(dataUrl);
      if (!cache.size && caches.get(doc) === cache) caches.delete(doc);
    }
  };
}
function originalImageSource(image) {
  return originals.get(image) || image.currentSrc || image.src;
}
function clearImageSources() {
  for (const cache of caches.values()) for (const entry of cache.values()) entry.revoke();
  caches.clear();
}

// src/preview.ts
var ImageWidget = class extends import_view.WidgetType {
  constructor(url, alt, startMove, width, startResize) {
    super();
    this.url = url;
    this.alt = alt;
    this.startMove = startMove;
    this.width = width;
    this.startResize = startResize;
    this.releases = /* @__PURE__ */ new WeakMap();
  }
  eq(other) {
    return other.url === this.url && other.alt === this.alt && other.startMove === this.startMove && other.width === this.width && other.startResize === this.startResize;
  }
  toDOM(view) {
    const wrap = view.dom.ownerDocument.createElement("span");
    wrap.className = "inline-images-preview inline-images-frame";
    wrap.setAttribute("translate", "no");
    wrap.classList.add("notranslate");
    const img = wrap.ownerDocument.createElement("img");
    this.releases.set(wrap, bindImageSource(img, this.url));
    img.alt = this.alt;
    img.loading = "lazy";
    attachImageZoom(img, this.startMove ? (event) => this.startMove(event, img, view.posAtDOM(wrap)) : void 0);
    img.addEventListener("load", () => view.requestMeasure());
    img.addEventListener("error", () => {
      img.hidden = true;
      const message = wrap.ownerDocument.createElement("span");
      message.textContent = `\u56FE\u7247\u65E0\u6CD5\u663E\u793A\uFF1A${this.alt}`;
      wrap.prepend(message);
      view.requestMeasure();
    });
    wrap.append(img);
    const button = wrap.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "inline-images-delete";
    button.textContent = "\u5220\u9664\u56FE\u7247";
    button.setAttribute("aria-label", `\u5220\u9664\u56FE\u7247\uFF1A${this.alt}`);
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const position = view.posAtDOM(wrap);
      const range = imageDeletionRange(view.state.doc.toString(), this.alt, this.url, position);
      if (!range) return;
      view.dispatch({
        changes: { ...range, insert: "" },
        selection: { anchor: range.from },
        annotations: import_state.Transaction.userEvent.of("delete.selection"),
        scrollIntoView: true
      });
      view.focus();
    });
    wrap.append(button);
    if (this.startResize) attachImageResize(
      img,
      wrap,
      this.width,
      () => this.startResize(img, view.posAtDOM(wrap)),
      () => view.requestMeasure()
    );
    else if (this.width !== void 0) {
      img.style.width = `${this.width}px`;
      img.classList.add("inline-images-user-sized");
    }
    wrap.title = "\u56FE\u7247\u5DF2\u4FDD\u5B58\u5728\u6B64 Markdown \u6587\u4EF6\u4E2D\uFF1B\u53EF\u5728\u8BBE\u7F6E\u4E2D\u5173\u95ED\u9884\u89C8\u67E5\u770B\u539F\u59CB\u7F16\u7801";
    return wrap;
  }
  destroy(dom) {
    this.releases.get(dom)?.();
    this.releases.delete(dom);
  }
  ignoreEvent() {
    return false;
  }
};
function imagePreview(startMove, startResize) {
  const field = import_state.StateField.define({
    create: (state) => build(state, startMove, startResize),
    update(value, tr) {
      if (!tr.docChanged) return value;
      let rebuild = false;
      tr.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
        if (/```|data:image\/|!\[/.test(inserted.toString())) rebuild = true;
        value.between(from, to, (start, end) => {
          if (from <= end && to >= start) rebuild = true;
        });
      });
      return rebuild ? build(tr.state, startMove, startResize) : value.map(tr.changes);
    },
    provide: (f) => [
      import_view.EditorView.decorations.from(f),
      import_view.EditorView.atomicRanges.of((view) => view.state.field(f))
    ]
  });
  return field;
}
function build(state, startMove, startResize) {
  const ranges = [];
  const tree = (0, import_language.syntaxTree)(state);
  for (const match of embeddedImages(state.doc.toString())) {
    const from = match.index;
    const isBlock = match[0].startsWith("```inline-image");
    let node = tree.resolveInner(from, 1);
    let inCode = false;
    while (node) {
      if (/code|frontmatter|comment/i.test(node.name)) {
        inCode = true;
        break;
      }
      node = node.parent;
    }
    if (inCode && !isBlock) continue;
    ranges.push(import_view.Decoration.replace({
      widget: new ImageWidget(match[2], match[1], startMove, match.width, startResize),
      block: isBlock
    }).range(from, from + match[0].length));
  }
  return import_view.Decoration.set(ranges);
}

// src/compression.ts
var DEFAULT_COMPRESSION = { enabled: true, quality: 0.9, maxDimension: 3200 };
function scaledDimensions(width, height, maxDimension) {
  const ratio = maxDimension > 0 ? Math.min(1, maxDimension / Math.max(width, height)) : 1;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}
function readBytes(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(new Error("\u8BFB\u53D6\u56FE\u7247\u5931\u8D25"));
    reader.onabort = () => reject(new Error("\u8BFB\u53D6\u56FE\u7247\u53D6\u6D88"));
    reader.readAsArrayBuffer(file);
  });
}
function isAnimated(bytes, mime) {
  const text = (p) => String.fromCharCode(...bytes.subarray(p, p + 4));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === "image/png") {
    for (let p = 8; p + 12 <= bytes.length; ) {
      const length = view.getUint32(p);
      const kind = text(p + 4);
      if (kind === "acTL") return true;
      if (kind === "IDAT" || kind === "IEND") return false;
      p += 12 + length;
    }
  } else if (mime === "image/webp") {
    for (let p = 12; p + 8 <= bytes.length; ) {
      const length = view.getUint32(p + 4, true);
      const kind = text(p);
      if (kind === "ANIM" || kind === "ANMF") return true;
      if (kind === "VP8X" && length > 0 && p + 8 < bytes.length && bytes[p + 8] & 2) return true;
      p += 8 + length + length % 2;
    }
  }
  return false;
}
function keepSmaller(original, result) {
  return result.size > 0 && result.size < original.size ? result : original;
}
async function compressImage(file, options) {
  const mime = imageMime(file);
  if (!options.enabled || !mime || !["image/jpeg", "image/png", "image/webp", "image/bmp"].includes(mime)) return file;
  let url;
  let canvas;
  let img;
  try {
    if ((mime === "image/png" || mime === "image/webp") && isAnimated(await readBytes(file), mime)) return file;
    url = URL.createObjectURL(file);
    img = document.createElement("img");
    const decoded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("\u56FE\u7247\u89E3\u7801\u8D85\u65F6")), 15e3);
      img.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      img.onerror = () => {
        clearTimeout(timer);
        reject(new Error("\u56FE\u7247\u89E3\u7801\u5931\u8D25"));
      };
    });
    img.src = url;
    await decoded;
    if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 8e7) return file;
    const size = scaledDimensions(img.naturalWidth, img.naturalHeight, options.maxDimension);
    canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(img, 0, 0, size.width, size.height);
    const outputMime = mime === "image/jpeg" ? "image/jpeg" : "image/webp";
    const quality = mime === "image/png" ? Math.max(0.95, options.quality) : options.quality;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, outputMime, quality));
    if (!blob || blob.type !== outputMime) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + (outputMime === "image/jpeg" ? ".jpg" : ".webp");
    return keepSmaller(file, new File([blob], name, { type: outputMime, lastModified: file.lastModified }));
  } catch {
    return file;
  } finally {
    if (url) URL.revokeObjectURL(url);
    if (img) {
      img.onload = null;
      img.onerror = null;
      img.src = "";
    }
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

// src/move.ts
var IMAGE_MOVE_TYPE = "application/x-obsidian-inline-images-move";
function planImageMove(text, range, destination) {
  if (range.from < 0 || range.to > text.length || range.from >= range.to || destination < 0 || destination > text.length) return null;
  if (destination >= range.from && destination <= range.to) return null;
  const insertion = "\n\n" + text.slice(range.from, range.to) + "\n\n";
  const changes = [
    { from: range.from, to: range.to, insert: "" },
    { from: destination, to: destination, insert: insertion }
  ].sort((a, b) => a.from - b.from);
  const cursor = destination + insertion.length - (destination > range.to ? range.to - range.from : 0);
  return { changes, cursor };
}

// src/main.ts
var DEFAULTS = {
  paste: true,
  drop: true,
  preview: true,
  maxMiB: 10,
  compress: true,
  quality: DEFAULT_COMPRESSION.quality,
  maxDimension: DEFAULT_COMPRESSION.maxDimension
};
var InlineImages = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.busy = /* @__PURE__ */ new WeakSet();
    this.alive = true;
    this.previewExtensions = [];
    this.imagePickers = /* @__PURE__ */ new Set();
    this.startImageResize = (image, position) => this.beginImageResize(image, position);
    this.startImageMove = (event, image, position) => {
      const view = this.app.workspace.getLeavesOfType("markdown").map((leaf) => leaf.view).find((view2) => view2 instanceof import_obsidian.MarkdownView && view2.containerEl.contains(image));
      if (!view?.file || view.getMode() !== "source" || !event.dataTransfer) {
        event.preventDefault();
        new import_obsidian.Notice("\u8BF7\u5207\u6362\u5230\u7F16\u8F91\u6A21\u5F0F\u540E\u62D6\u52A8\u56FE\u7247\u3002");
        return;
      }
      const text = view.editor.getValue();
      const range = imageDeletionRange(text, image.alt, originalImageSource(image), position);
      if (!range) {
        event.preventDefault();
        return;
      }
      const token = crypto.randomUUID();
      this.imageMove = { token, path: view.file.path, text, ...range };
      event.dataTransfer.clearData();
      event.dataTransfer.setData(IMAGE_MOVE_TYPE, token);
      event.dataTransfer.effectAllowed = "move";
      image.addEventListener("dragend", () => {
        if (this.imageMove?.token === token) this.imageMove = void 0;
      }, { once: true });
    };
  }
  async onload() {
    const saved = await this.loadData();
    this.settings = { ...DEFAULTS, ...saved };
    this.settings.maxMiB = Math.min(50, Math.max(1, Number(this.settings.maxMiB) || 10));
    this.settings.quality = Math.min(1, Math.max(0.7, Number(this.settings.quality) || 0.9));
    if (![0, 2560, 3200, 4096].includes(this.settings.maxDimension)) this.settings.maxDimension = 3200;
    if (this.settings.preview) this.previewExtensions.push(imagePreview(this.startImageMove, this.startImageResize));
    this.registerEditorExtension(this.previewExtensions);
    this.registerEditorExtension(import_view2.EditorView.domEventHandlers({
      dragover(event) {
        if (!event.dataTransfer?.types.includes(IMAGE_MOVE_TYPE)) return false;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        return true;
      }
    }));
    this.registerMarkdownCodeBlockProcessor("inline-image", (source, element, context) => {
      const image = parseImageBlock(source);
      if (!image) {
        element.createEl("p", { text: "\u56FE\u7247\u6570\u636E\u4E0D\u5B8C\u6574\uFF0C\u8BF7\u4ECE\u5907\u4EFD\u6062\u590D\u3002" });
        return;
      }
      const frame = element.createDiv({ cls: "inline-images-frame" });
      frame.setAttribute("translate", "no");
      frame.addClass("notranslate");
      const img = frame.createEl("img", { attr: { alt: image.alt, loading: "lazy" } });
      const lifecycle = new import_obsidian.MarkdownRenderChild(element);
      lifecycle.register(bindImageSource(img, image.url));
      context.addChild(lifecycle);
      img.addClass("inline-images-rendered");
      attachImageZoom(img, (event) => {
        const view = this.app.workspace.getLeavesOfType("markdown").map((leaf) => leaf.view).find((view2) => view2 instanceof import_obsidian.MarkdownView && view2.containerEl.contains(img));
        const line = context.getSectionInfo(element)?.lineStart;
        const position = view && line !== void 0 ? view.editor.posToOffset({ line, ch: 0 }) : void 0;
        this.startImageMove(event, img, position);
      });
      attachImageResize(img, frame, image.width, () => {
        const line = context.getSectionInfo(element)?.lineStart;
        return this.beginImageResize(img, line === void 0 ? void 0 : { line });
      });
      const button = frame.createEl("button", {
        text: "\u5220\u9664\u56FE\u7247",
        cls: "inline-images-delete",
        attr: { type: "button", "aria-label": `\u5220\u9664\u56FE\u7247\uFF1A${image.alt}` }
      });
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        let view = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
        if (!view || view.file?.path !== context.sourcePath) {
          new import_obsidian.Notice("\u8BF7\u5728\u8FD9\u7BC7\u7B14\u8BB0\u4E2D\u64CD\u4F5C\u5220\u9664\u56FE\u7247\u3002");
          return;
        }
        const line = context.getSectionInfo(element)?.lineStart;
        if (view.getMode() !== "source") {
          await view.leaf.setViewState({
            type: "markdown",
            state: { file: context.sourcePath, mode: "source", source: false }
          });
          view = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
        }
        if (!view || view.file?.path !== context.sourcePath) return;
        const editor = view.editor;
        const position = line === void 0 ? void 0 : editor.posToOffset({ line, ch: 0 });
        const range = imageDeletionRange(editor.getValue(), image.alt, image.url, position);
        if (!range) {
          new import_obsidian.Notice("\u56FE\u7247\u4F4D\u7F6E\u5DF2\u6539\u53D8\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u7B14\u8BB0\u540E\u518D\u5220\u9664\u3002");
          return;
        }
        editor.replaceRange("", editor.offsetToPos(range.from), editor.offsetToPos(range.to), "inline-images-delete");
        editor.setCursor(editor.offsetToPos(range.from));
        editor.focus();
        new import_obsidian.Notice("\u56FE\u7247\u5DF2\u5220\u9664\uFF0C\u53EF\u6309 \u2318Z / Ctrl+Z \u64A4\u9500\u3002");
      });
    });
    this.registerEvent(this.app.workspace.on("editor-paste", (event, editor, info) => {
      if (!this.settings.paste || event.defaultPrevented) return;
      const files = Array.from(event.clipboardData?.files ?? []);
      this.handleEvent(event, files, editor, info);
    }));
    this.registerEvent(this.app.workspace.on("editor-drop", (event, editor, info) => {
      if (event.defaultPrevented) return;
      const files = Array.from(event.dataTransfer?.files ?? []);
      const dom = event.target?.closest?.(".cm-editor");
      const cm = dom && typeof import_view2.EditorView.findFromDOM === "function" ? import_view2.EditorView.findFromDOM(dom) : null;
      const offset = cm?.posAtCoords({ x: event.clientX, y: event.clientY });
      if (this.dropImageMove(event, editor, info, offset ?? editor.posToOffset(editor.getCursor()))) return;
      if (!this.settings.drop) return;
      this.handleEvent(
        event,
        files,
        editor,
        info,
        offset != null ? editor.offsetToPos(offset) : void 0
      );
    }));
    this.addCommand({
      id: "insert-images",
      name: "\u9009\u62E9\u56FE\u7247\uFF0C\u76F4\u63A5\u5B58\u8FDB\u5F53\u524D\u7B14\u8BB0",
      editorCallback: (editor, info) => this.pickImages(editor, info)
    });
    this.addRibbonIcon("image-plus", "\u6DFB\u52A0\u56FE\u7247\u5230\u7B14\u8BB0", () => {
      const view = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
      if (!view?.file) {
        new import_obsidian.Notice("\u8BF7\u5148\u6253\u5F00\u8981\u6DFB\u52A0\u56FE\u7247\u7684\u7B14\u8BB0\u3002");
        return;
      }
      if (view.getMode() !== "source") {
        new import_obsidian.Notice("\u8BF7\u5148\u5207\u6362\u5230\u7F16\u8F91\u6A21\u5F0F\uFF0C\u518D\u6DFB\u52A0\u56FE\u7247\u3002");
        return;
      }
      this.pickImages(view.editor, view);
    });
    this.addSettingTab(new InlineImagesSettings(this));
    this.addCommand({
      id: "optimize-note-images",
      name: "\u4F18\u5316\u5F53\u524D\u7B14\u8BB0\u7684\u56FE\u7247\u6027\u80FD",
      editorCallback: (editor) => {
        const original = editor.getValue();
        const result = compactImageBlocks(original);
        if (!result.changed) {
          new import_obsidian.Notice("\u5F53\u524D\u56FE\u7247\u5DF2\u7ECF\u662F\u4F18\u5316\u540E\u7684\u5B58\u50A8\u683C\u5F0F\u3002");
          return;
        }
        editor.replaceRange(result.text, { line: 0, ch: 0 }, editor.offsetToPos(original.length), "inline-images-compact");
        new import_obsidian.Notice(`\u5DF2\u4F18\u5316 ${result.changed} \u5F20\u56FE\u7247\u7684\u5B58\u50A8\u6392\u7248\uFF0C\u56FE\u7247\u5185\u5BB9\u548C\u663E\u793A\u5C3A\u5BF8\u4FDD\u6301\u4E0D\u53D8\u3002`);
      }
    });
  }
  onunload() {
    this.alive = false;
    this.imageMove = void 0;
    for (const input of this.imagePickers) input.remove();
    this.imagePickers.clear();
    cancelImageResizes();
    closeImageZooms();
    clearImageSources();
  }
  pickImages(editor, info) {
    const initialFile = info.file;
    const initialText = editor.getValue();
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp,image/svg+xml";
    input.multiple = true;
    input.hidden = true;
    const cleanup = () => {
      input.remove();
      this.imagePickers.delete(input);
    };
    input.addEventListener("cancel", cleanup, { once: true });
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      cleanup();
      if (!this.alive || !files.length) return;
      if (info.file !== initialFile || editor.getValue() !== initialText) {
        new import_obsidian.Notice("\u7B14\u8BB0\u5DF2\u5207\u6362\u6216\u5185\u5BB9\u5DF2\u6539\u53D8\uFF0C\u8BF7\u5728\u76EE\u6807\u4F4D\u7F6E\u91CD\u65B0\u9009\u62E9\u56FE\u7247\u3002");
        return;
      }
      void this.insert(files, editor, info, from, to);
    }, { once: true });
    this.imagePickers.add(input);
    document.body.append(input);
    try {
      input.click();
    } catch {
      cleanup();
      new import_obsidian.Notice("\u65E0\u6CD5\u6253\u5F00\u56FE\u7247\u9009\u62E9\u5668\uFF0C\u8BF7\u91CD\u8BD5\u3002");
    }
  }
  beginImageResize(image, position) {
    const owner = this.app.workspace.getLeavesOfType("markdown").map((leaf) => leaf.view).find((view) => view instanceof import_obsidian.MarkdownView && view.containerEl.contains(image));
    if (!owner?.file) return null;
    const file = owner.file;
    const alt = image.alt, url = originalImageSource(image);
    const snapshot = owner.getMode() === "source" ? Promise.resolve(owner.editor.getValue()) : this.app.vault.cachedRead(file);
    return async (width) => {
      const original = await snapshot;
      if (!this.alive || owner.file !== file) return;
      if (owner.getMode() !== "source") {
        await owner.leaf.setViewState({ type: "markdown", state: { file: file.path, mode: "source", source: false } });
      }
      const view = owner.leaf.view;
      if (!(view instanceof import_obsidian.MarkdownView) || view.file !== file) return;
      const editor = view.editor;
      if (editor.getValue() !== original) {
        new import_obsidian.Notice("\u7B14\u8BB0\u5185\u5BB9\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u8C03\u6574\u56FE\u7247\u5927\u5C0F\u3002");
        return;
      }
      const near = typeof position === "number" ? position : position ? editor.posToOffset({ line: position.line, ch: 0 }) : void 0;
      const range = imageDeletionRange(original, alt, url, near);
      const change = range && imageWidthChange(original, range, width);
      if (!change) {
        new import_obsidian.Notice("\u65E0\u6CD5\u5B9A\u4F4D\u56FE\u7247\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u7B14\u8BB0\u540E\u518D\u8C03\u6574\u5927\u5C0F\u3002");
        return;
      }
      if (original.slice(change.from, change.to) === change.insert) return;
      editor.replaceRange(change.insert, editor.offsetToPos(change.from), editor.offsetToPos(change.to), "inline-images-resize");
      editor.focus();
    };
  }
  dropImageMove(event, editor, info, destination) {
    const token = event.dataTransfer?.getData(IMAGE_MOVE_TYPE);
    if (!token) return false;
    event.preventDefault();
    const move = this.imageMove;
    this.imageMove = void 0;
    if (!move || move.token !== token || info.file?.path !== move.path) {
      new import_obsidian.Notice("\u76EE\u524D\u652F\u6301\u5728\u540C\u4E00\u7BC7\u7B14\u8BB0\u5185\u79FB\u52A8\u56FE\u7247\u3002");
      return true;
    }
    const text = editor.getValue();
    if (text !== move.text) {
      new import_obsidian.Notice("\u62D6\u52A8\u671F\u95F4\u7B14\u8BB0\u5185\u5BB9\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u8BD5\u3002");
      return true;
    }
    const plan = planImageMove(text, move, destination);
    if (!plan) return true;
    editor.transaction({ changes: plan.changes.map((change) => ({
      from: editor.offsetToPos(change.from),
      to: editor.offsetToPos(change.to),
      text: change.insert
    })) }, "inline-images-move");
    editor.setCursor(editor.offsetToPos(plan.cursor));
    editor.focus();
    return true;
  }
  handleEvent(event, files, editor, info, position) {
    if (!files.some((f) => imageMime(f))) return;
    event.preventDefault();
    if (files.some((f) => !imageMime(f))) {
      new import_obsidian.Notice("\u8BF7\u628A\u56FE\u7247\u548C\u5176\u4ED6\u6587\u4EF6\u5206\u5F00\u63D2\u5165\uFF0C\u672C\u6B21\u6CA1\u6709\u4FDD\u5B58\u9644\u4EF6\u3002");
      return;
    }
    const from = position ?? editor.getCursor("from");
    const to = position ?? editor.getCursor("to");
    void this.insert(files, editor, info, from, to);
  }
  async insert(files, editor, info, from, to) {
    if (!files.length) return;
    if (this.busy.has(editor)) {
      new import_obsidian.Notice("\u4E0A\u4E00\u6279\u56FE\u7247\u4ECD\u5728\u8BFB\u53D6\uFF0C\u8BF7\u7A0D\u540E\u518D\u63D2\u5165\u3002");
      return;
    }
    const file = info.file;
    if (!file || file.extension !== "md") {
      new import_obsidian.Notice("\u8BF7\u5148\u6253\u5F00\u4E00\u7BC7 Markdown \u7B14\u8BB0\u3002");
      return;
    }
    const originalText = editor.getValue();
    this.busy.add(editor);
    const progress = new import_obsidian.Notice(this.settings.compress ? "\u6B63\u5728\u538B\u7F29\u5E76\u5D4C\u5165\u56FE\u7247\u2026" : "\u6B63\u5728\u5D4C\u5165\u56FE\u7247\u2026", 0);
    try {
      let originalBytes = 0;
      let outputBytes = 0;
      const options = {
        enabled: this.settings.compress,
        quality: this.settings.quality,
        maxDimension: this.settings.maxDimension
      };
      const markdown = await encodeImages(files, this.settings.maxMiB, async (file2) => {
        const result = await compressImage(file2, options);
        originalBytes += file2.size;
        outputBytes += result.size;
        return result;
      });
      if (!this.alive) return;
      if (info.file !== file || editor.getValue() !== originalText) {
        new import_obsidian.Notice("\u8BFB\u53D6\u56FE\u7247\u65F6\u7B14\u8BB0\u5DF2\u5207\u6362\u6216\u5185\u5BB9\u5DF2\u6539\u53D8\uFF0C\u8BF7\u91CD\u65B0\u63D2\u5165\u3002\u56FE\u7247\u6CA1\u6709\u5199\u5165\u5176\u4ED6\u7B14\u8BB0\u3002", 7e3);
        return;
      }
      editor.replaceRange(`

${markdown}

`, from, to);
      const saved = originalBytes - outputBytes;
      const summary = saved > 0 ? `\u56FE\u7247\u4F53\u79EF\u51CF\u5C11 ${Math.round(saved / originalBytes * 100)}%\u3002` : "\u56FE\u7247\u4FDD\u7559\u539F\u6837\u3002";
      new import_obsidian.Notice(`\u5DF2\u5C06 ${files.length} \u5F20\u56FE\u7247\u5B58\u5165\u7B14\u8BB0\u3002${summary}\u6CA1\u6709\u521B\u5EFA\u56FE\u7247\u9644\u4EF6\u3002`, 6e3);
    } catch (error) {
      new import_obsidian.Notice(error instanceof Error ? error.message : "\u63D2\u5165\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u56FE\u7247\u3002", 7e3);
    } finally {
      progress.hide();
      this.busy.delete(editor);
    }
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async setPreview(enabled) {
    this.settings.preview = enabled;
    await this.saveSettings();
    this.previewExtensions.splice(0, this.previewExtensions.length, ...enabled ? [imagePreview(this.startImageMove, this.startImageResize)] : []);
    this.app.workspace.updateOptions();
  }
};
var InlineImagesSettings = class extends import_obsidian.PluginSettingTab {
  constructor(plugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl, plugin } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "\u56FE\u7247\u5B58\u8FDB\u7B14\u8BB0" });
    containerEl.createEl("p", { text: "\u56FE\u7247\u5148\u5728\u672C\u673A\u538B\u7F29\uFF0C\u518D\u4FDD\u5B58\u5728 .md \u5185\uFF0C\u4E0D\u4F1A\u4E0A\u4F20\u3002\u53EA\u5728\u538B\u7F29\u7ED3\u679C\u66F4\u5C0F\u65F6\u91C7\u7528\uFF0C\u4E0D\u81EA\u52A8\u5904\u7406\u5DF2\u6709\u56FE\u7247\u3002" });
    new import_obsidian.Setting(containerEl).setName("\u5BFC\u5165\u65F6\u81EA\u52A8\u538B\u7F29").setDesc("\u9ED8\u8BA4\u5F00\u542F\u3002GIF\u3001SVG\u3001AVIF \u548C\u68C0\u6D4B\u5230\u7684\u52A8\u753B\u4FDD\u7559\u539F\u6837\uFF1B\u538B\u7F29\u5931\u8D25\u65F6\u4E5F\u4FDD\u7559\u539F\u56FE\u3002").addToggle((t) => t.setValue(plugin.settings.compress).onChange(async (value) => {
      plugin.settings.compress = value;
      await plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("\u538B\u7F29\u753B\u8D28").setDesc("\u9ED8\u8BA4 90%\uFF0C\u504F\u5411\u4FDD\u7559\u7EC6\u8282\uFF1BPNG \u622A\u56FE\u81F3\u5C11\u4F7F\u7528 95%\u3002\u767E\u5206\u6BD4\u4E3A\u7F16\u7801\u53C2\u6570\uFF0C\u4E0D\u662F\u753B\u8D28\u4FDD\u7559\u6BD4\u4F8B\u3002").addSlider((s) => s.setLimits(70, 100, 1).setValue(Math.round(plugin.settings.quality * 100)).setDynamicTooltip().onChange(async (value) => {
      plugin.settings.quality = value / 100;
      await plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("\u56FE\u7247\u6700\u957F\u8FB9").setDesc("\u9ED8\u8BA4 3200 \u50CF\u7D20\uFF1B\u5C0F\u56FE\u4E0D\u4F1A\u653E\u5927\u3002\u53EF\u9009\u4FDD\u7559\u539F\u59CB\u5C3A\u5BF8\u3002").addDropdown((d) => d.addOptions({ "0": "\u4FDD\u7559\u539F\u59CB\u5C3A\u5BF8", "2560": "2560 \u50CF\u7D20", "3200": "3200 \u50CF\u7D20\uFF08\u63A8\u8350\uFF09", "4096": "4096 \u50CF\u7D20" }).setValue(String(plugin.settings.maxDimension)).onChange(async (value) => {
      plugin.settings.maxDimension = Number(value);
      await plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("\u63A5\u7BA1\u56FE\u7247\u7C98\u8D34").addToggle((t) => t.setValue(plugin.settings.paste).onChange(async (value) => {
      plugin.settings.paste = value;
      await plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("\u63A5\u7BA1\u56FE\u7247\u62D6\u5165").addToggle((t) => t.setValue(plugin.settings.drop).onChange(async (value) => {
      plugin.settings.drop = value;
      await plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("\u6298\u53E0\u7F16\u7801\u5E76\u663E\u793A\u56FE\u7247").setDesc("\u7F16\u8F91\u89C6\u56FE\u4E2D\u7528\u56FE\u7247\u4EE3\u66FF\u957F\u7F16\u7801\u3002\u5173\u95ED\u540E\u53EF\u67E5\u770B\u548C\u7F16\u8F91\u539F\u59CB Markdown\u3002").addToggle((t) => t.setValue(plugin.settings.preview).onChange(async (value) => {
      await plugin.setPreview(value);
    }));
    new import_obsidian.Setting(containerEl).setName("\u5355\u5F20\u56FE\u7247\u4E0A\u9650\uFF08MB\uFF09").setDesc("1\u201350 MB\uFF1B\u9ED8\u8BA4 10 MB\u3002\u4E00\u6B21\u603B\u91CF\u6700\u591A 40 MB\u3002").addText((t) => t.setValue(String(plugin.settings.maxMiB)).onChange(async (value) => {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 1 || n > 50) {
        new import_obsidian.Notice("\u8BF7\u8F93\u5165 1 \u5230 50 \u4E4B\u95F4\u7684\u6570\u5B57\u3002");
        return;
      }
      plugin.settings.maxMiB = n;
      await plugin.saveSettings();
    }));
  }
};
