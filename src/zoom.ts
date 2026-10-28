const activeZooms = new Map<Document, () => void>();

export function closeImageZooms() {
  for (const close of [...activeZooms.values()]) close();
}

export function openImageZoom(original: HTMLImageElement) {
  const doc = original.ownerDocument;
  const win = doc.defaultView;
  if (!win) return;
  activeZooms.get(doc)?.();
  const previousFocus = doc.activeElement as HTMLElement | null;
  const overlay = doc.createElement('div');
  overlay.className = 'inline-images-lightbox';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `图片放大预览：${original.alt || '图片'}`);
  const image = doc.createElement('img');
  image.className = 'inline-images-lightbox-image';
  image.alt = original.alt;
  image.draggable = false;
  const closeButton = doc.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'inline-images-lightbox-close';
  closeButton.textContent = '关闭 ×';
  closeButton.setAttribute('aria-label', '关闭图片预览');
  const caption = doc.createElement('div');
  caption.className = 'inline-images-lightbox-caption';
  caption.textContent = original.alt;
  const fit = () => {
    const width = image.naturalWidth || original.naturalWidth;
    const height = image.naturalHeight || original.naturalHeight;
    if (!width || !height) return;
    const scale = Math.min(Math.max(1, win.innerWidth - 48) / width,
      Math.max(1, win.innerHeight - 120) / height);
    image.style.width = `${Math.max(1, Math.round(width * scale))}px`;
    image.style.height = `${Math.max(1, Math.round(height * scale))}px`;
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'Tab') { event.preventDefault(); closeButton.focus(); }
  };
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    doc.removeEventListener('keydown', onKey, true);
    win.removeEventListener('resize', fit);
    overlay.remove();
    image.removeAttribute('src');
    activeZooms.delete(doc);
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
  activeZooms.set(doc, close);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) { event.preventDefault(); event.stopPropagation(); close(); }
  });
  closeButton.addEventListener('click', close);
  image.addEventListener('load', fit);
  overlay.append(image, closeButton, caption);
  doc.body.append(overlay);
  doc.addEventListener('keydown', onKey, true);
  win.addEventListener('resize', fit);
  image.src = original.currentSrc || original.src;
  fit();
  closeButton.focus();
}

/** Keep the first click from switching the code block into its raw source. */
export function attachImageZoom(image: HTMLImageElement, onDragStart?: (event: DragEvent) => void) {
  image.classList.add('inline-images-zoomable');
  image.title = onDragStart ? '拖动调整图片位置；双击放大' : '双击放大图片';
  image.draggable = Boolean(onDragStart);
  image.tabIndex = 0;
  image.addEventListener('mousedown', event => { event.stopPropagation(); });
  if (onDragStart) image.addEventListener('dragstart', onDragStart);
  image.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
  image.addEventListener('dblclick', event => {
    event.preventDefault(); event.stopPropagation(); openImageZoom(image);
  });
  image.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopPropagation(); openImageZoom(image);
    }
  });
}
