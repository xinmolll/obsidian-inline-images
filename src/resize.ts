export type ResizeCommit = (width?: number) => void | Promise<void>;
export type StartResize = (image: HTMLImageElement, position: number) => ResizeCommit | null;
const activeResizes = new Set<() => void>();
export function cancelImageResizes() { for (const cancel of [...activeResizes]) cancel(); }

export function attachImageResize(image: HTMLImageElement, frame: HTMLElement, width: number | undefined,
  begin: () => ResizeCommit | null, measure?: () => void) {
  const doc = frame.ownerDocument;
  if (width !== undefined) {
    image.style.width = `${width}px`;
    image.classList.add('inline-images-user-sized');
  }
  const handle = doc.createElement('button');
  handle.type = 'button';
  handle.className = 'inline-images-resize';
  handle.title = '拖动调整图片大小；双击恢复自动大小';
  handle.setAttribute('aria-label', '调整图片大小');
  handle.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });
  handle.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
  handle.addEventListener('dblclick', event => {
    event.preventDefault(); event.stopPropagation();
    const commit = begin();
    if (commit) void commit(undefined);
  });
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const commit = begin();
    if (!commit) return;
    const initialRect = image.getBoundingClientRect();
    const initialWidth = initialRect.width;
    const aspect = initialRect.height > 0 ? initialWidth / initialRect.height : 1;
    const maxWidth = Math.max(64, frame.parentElement?.clientWidth || initialWidth);
    const oldStyle = image.style.width;
    const hadSize = image.classList.contains('inline-images-user-sized');
    const startX = event.clientX;
    const startY = event.clientY;
    let latest = initialWidth;
    let changed = false;
    const cleanup = () => {
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', finish, true);
      doc.removeEventListener('pointercancel', cancel, true);
      activeResizes.delete(cancel);
      frame.classList.remove('is-resizing');
    };
    const cancel = () => {
      cleanup(); image.style.width = oldStyle;
      image.classList.toggle('inline-images-user-sized', hadSize); measure?.();
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      next.preventDefault(); next.stopPropagation();
      const dx = next.clientX - startX, dy = next.clientY - startY;
      const delta = Math.abs(dx) >= Math.abs(dy * aspect) ? dx : dy * aspect;
      latest = Math.round(Math.min(maxWidth, Math.max(64, initialWidth + delta)));
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 2 && !changed) return;
      changed = true;
      image.classList.add('inline-images-user-sized');
      image.style.width = `${latest}px`;
      measure?.();
    };
    const finish = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      next.preventDefault(); next.stopPropagation();
      cleanup();
      if (changed) void commit(latest);
    };
    frame.classList.add('is-resizing');
    activeResizes.add(cancel);
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', finish, true);
    doc.addEventListener('pointercancel', cancel, true);
  });
  frame.append(handle);
}
