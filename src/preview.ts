import { StateField, Transaction } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { embeddedImages, imageDeletionRange } from './core';
import { attachImageZoom } from './zoom';
import { attachImageResize, StartResize } from './resize';
import { bindImageSource } from './image-source';
type StartMove = (event: DragEvent, image: HTMLImageElement, position: number) => void;

class ImageWidget extends WidgetType {
  private releases = new WeakMap<HTMLElement, () => void>();
  constructor(readonly url: string, readonly alt: string, readonly startMove?: StartMove,
    readonly width?: number, readonly startResize?: StartResize) { super(); }
  eq(other: ImageWidget) { return other.url === this.url && other.alt === this.alt && other.startMove === this.startMove
    && other.width === this.width && other.startResize === this.startResize; }
  toDOM(view: EditorView) {
    const wrap = view.dom.ownerDocument.createElement('span');
    wrap.className = 'inline-images-preview inline-images-frame';
    wrap.setAttribute('translate', 'no');
    wrap.classList.add('notranslate');
    const img = wrap.ownerDocument.createElement('img');
    this.releases.set(wrap, bindImageSource(img, this.url));
    img.alt = this.alt;
    img.loading = 'lazy';
    attachImageZoom(img, this.startMove ? event => this.startMove!(event, img, view.posAtDOM(wrap)) : undefined);
    img.addEventListener('load', () => view.requestMeasure());
    img.addEventListener('error', () => {
      img.hidden = true;
      const message = wrap.ownerDocument.createElement('span');
      message.textContent = `图片无法显示：${this.alt}`;
      wrap.prepend(message);
      view.requestMeasure();
    });
    wrap.append(img);
    const button = wrap.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'inline-images-delete';
    button.textContent = '删除图片';
    button.setAttribute('aria-label', `删除图片：${this.alt}`);
    button.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });
    button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      const position = view.posAtDOM(wrap);
      const range = imageDeletionRange(view.state.doc.toString(), this.alt, this.url, position);
      if (!range) return;
      view.dispatch({ changes: { ...range, insert: '' }, selection: { anchor: range.from },
        annotations: Transaction.userEvent.of('delete.selection'), scrollIntoView: true });
      view.focus();
    });
    wrap.append(button);
    if (this.startResize) attachImageResize(img, wrap, this.width,
      () => this.startResize!(img, view.posAtDOM(wrap)), () => view.requestMeasure());
    else if (this.width !== undefined) { img.style.width = `${this.width}px`; img.classList.add('inline-images-user-sized'); }
    wrap.title = '图片已保存在此 Markdown 文件中；可在设置中关闭预览查看原始编码';
    return wrap;
  }
  destroy(dom: HTMLElement) { this.releases.get(dom)?.(); this.releases.delete(dom); }
  ignoreEvent() { return false; }
}

export function imagePreview(startMove?: StartMove, startResize?: StartResize) {
  const field = StateField.define<DecorationSet>({
    create: state => build(state, startMove, startResize),
    update(value, tr) {
      if (!tr.docChanged) return value;
      let rebuild = false;
      tr.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
        // Ordinary edits around an image only map offsets. Do not scan its data again.
        if (/```|data:image\/|!\[/.test(inserted.toString())) rebuild = true;
        value.between(from, to, (start, end) => {
          if (from <= end && to >= start) rebuild = true;
        });
      });
      return rebuild ? build(tr.state, startMove, startResize) : value.map(tr.changes);
    },
    provide: f => [
      EditorView.decorations.from(f),
      EditorView.atomicRanges.of(view => view.state.field(f)),
    ],
  });
  return field;
}

function build(state: import('@codemirror/state').EditorState, startMove?: StartMove, startResize?: StartResize): DecorationSet {
  const ranges = [];
  const tree = syntaxTree(state);
  for (const match of embeddedImages(state.doc.toString())) {
    const from = match.index!;
    const isBlock = match[0].startsWith('```inline-image');
    let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(from, 1);
    let inCode = false;
    while (node) {
      if (/code|frontmatter|comment/i.test(node.name)) { inCode = true; break; }
      node = node.parent;
    }
    if (inCode && !isBlock) continue;
    ranges.push(Decoration.replace({
      widget: new ImageWidget(match[2], match[1], startMove, match.width, startResize),
      block: isBlock,
    }).range(from, from + match[0].length));
  }
  return Decoration.set(ranges);
}
