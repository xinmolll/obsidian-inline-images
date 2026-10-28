import {
  Editor, MarkdownFileInfo, MarkdownView, MarkdownRenderChild, Notice, Plugin, PluginSettingTab, Setting,
} from 'obsidian';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { imageMime, encodeImages, parseImageBlock, imageDeletionRange, imageWidthChange, compactImageBlocks } from './core';
import { imagePreview } from './preview';
import { compressImage, DEFAULT_COMPRESSION } from './compression';
import { attachImageZoom, closeImageZooms } from './zoom';
import { IMAGE_MOVE_TYPE, planImageMove } from './move';
import { attachImageResize, cancelImageResizes, ResizeCommit } from './resize';
import { bindImageSource, originalImageSource, clearImageSources } from './image-source';

interface Settings { paste: boolean; drop: boolean; preview: boolean; maxMiB: number;
  compress: boolean; quality: number; maxDimension: number }
const DEFAULTS: Settings = { paste: true, drop: true, preview: true, maxMiB: 10,
  compress: true, quality: DEFAULT_COMPRESSION.quality, maxDimension: DEFAULT_COMPRESSION.maxDimension };
type Info = MarkdownView | MarkdownFileInfo;

export default class InlineImages extends Plugin {
  settings!: Settings;
  private busy = new WeakSet<Editor>();
  private alive = true;
  private previewExtensions: Extension[] = [];
  private imageMove?: { token: string; path: string; text: string; from: number; to: number };
  private imagePickers = new Set<HTMLInputElement>();

  async onload() {
    const saved = await this.loadData();
    this.settings = { ...DEFAULTS, ...saved };
    this.settings.maxMiB = Math.min(50, Math.max(1, Number(this.settings.maxMiB) || 10));
    this.settings.quality = Math.min(1, Math.max(0.7, Number(this.settings.quality) || 0.9));
    if (![0, 2560, 3200, 4096].includes(this.settings.maxDimension)) this.settings.maxDimension = 3200;
    if (this.settings.preview) this.previewExtensions.push(imagePreview(this.startImageMove, this.startImageResize));
    this.registerEditorExtension(this.previewExtensions);
    this.registerEditorExtension(EditorView.domEventHandlers({
      dragover(event) {
        if (!event.dataTransfer?.types.includes(IMAGE_MOVE_TYPE)) return false;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        return true;
      },
    }));
    this.registerMarkdownCodeBlockProcessor('inline-image', (source, element, context) => {
      const image = parseImageBlock(source);
      if (!image) { element.createEl('p', { text: '图片数据不完整，请从备份恢复。' }); return; }
      const frame = element.createDiv({ cls: 'inline-images-frame' });
      frame.setAttribute('translate', 'no');
      frame.addClass('notranslate');
      const img = frame.createEl('img', { attr: { alt: image.alt, loading: 'lazy' } });
      const lifecycle = new MarkdownRenderChild(element);
      lifecycle.register(bindImageSource(img, image.url));
      context.addChild(lifecycle);
      img.addClass('inline-images-rendered');
      attachImageZoom(img, event => {
        const view = this.app.workspace.getLeavesOfType('markdown')
          .map(leaf => leaf.view).find(view => view instanceof MarkdownView && view.containerEl.contains(img)) as MarkdownView | undefined;
        const line = context.getSectionInfo(element)?.lineStart;
        const position = view && line !== undefined ? view.editor.posToOffset({ line, ch: 0 }) : undefined;
        this.startImageMove(event, img, position);
      });
      attachImageResize(img, frame, image.width, () => {
        const line = context.getSectionInfo(element)?.lineStart;
        return this.beginImageResize(img, line === undefined ? undefined : { line });
      });
      const button = frame.createEl('button', { text: '删除图片', cls: 'inline-images-delete',
        attr: { type: 'button', 'aria-label': `删除图片：${image.alt}` } });
      button.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });
      button.addEventListener('click', async event => {
        event.preventDefault(); event.stopPropagation();
        let view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || view.file?.path !== context.sourcePath) {
          new Notice('请在这篇笔记中操作删除图片。'); return;
        }
        // Capture the section while the rendering element is still attached.
        const line = context.getSectionInfo(element)?.lineStart;
        if (view.getMode() !== 'source') {
          await view.leaf.setViewState({ type: 'markdown',
            state: { file: context.sourcePath, mode: 'source', source: false } });
          view = this.app.workspace.getActiveViewOfType(MarkdownView);
        }
        if (!view || view.file?.path !== context.sourcePath) return;
        const editor = view.editor;
        const position = line === undefined ? undefined : editor.posToOffset({ line, ch: 0 });
        const range = imageDeletionRange(editor.getValue(), image.alt, image.url, position);
        if (!range) { new Notice('图片位置已改变，请重新打开笔记后再删除。'); return; }
        editor.replaceRange('', editor.offsetToPos(range.from), editor.offsetToPos(range.to), 'inline-images-delete');
        editor.setCursor(editor.offsetToPos(range.from));
        editor.focus();
        new Notice('图片已删除，可按 ⌘Z / Ctrl+Z 撤销。');
      });
    });
    this.registerEvent(this.app.workspace.on('editor-paste', (event, editor, info) => {
      if (!this.settings.paste || event.defaultPrevented) return;
      const files = Array.from(event.clipboardData?.files ?? []);
      this.handleEvent(event, files, editor, info);
    }));
    this.registerEvent(this.app.workspace.on('editor-drop', (event, editor, info) => {
      if (event.defaultPrevented) return;
      const files = Array.from(event.dataTransfer?.files ?? []);
      const dom = (event.target as HTMLElement | null)?.closest?.('.cm-editor');
      const cm = dom && typeof EditorView.findFromDOM === 'function'
        ? EditorView.findFromDOM(dom as HTMLElement) : null;
      const offset = cm?.posAtCoords({ x: event.clientX, y: event.clientY });
      if (this.dropImageMove(event, editor, info, offset ?? editor.posToOffset(editor.getCursor()))) return;
      if (!this.settings.drop) return;
      this.handleEvent(event, files, editor, info,
        offset != null ? editor.offsetToPos(offset) : undefined);
    }));
    this.addCommand({
      id: 'insert-images', name: '选择图片，直接存进当前笔记',
      editorCallback: (editor, info) => this.pickImages(editor, info),
    });
    this.addRibbonIcon('image-plus', '添加图片到笔记', () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view?.file) { new Notice('请先打开要添加图片的笔记。'); return; }
      if (view.getMode() !== 'source') {
        new Notice('请先切换到编辑模式，再添加图片。'); return;
      }
      this.pickImages(view.editor, view);
    });
    this.addSettingTab(new InlineImagesSettings(this));
    this.addCommand({
      id: 'optimize-note-images', name: '优化当前笔记的图片性能',
      editorCallback: editor => {
        const original = editor.getValue();
        const result = compactImageBlocks(original);
        if (!result.changed) { new Notice('当前图片已经是优化后的存储格式。'); return; }
        editor.replaceRange(result.text, { line: 0, ch: 0 }, editor.offsetToPos(original.length), 'inline-images-compact');
        new Notice(`已优化 ${result.changed} 张图片的存储排版，图片内容和显示尺寸保持不变。`);
      },
    });
  }

  onunload() {
    this.alive = false; this.imageMove = undefined;
    for (const input of this.imagePickers) input.remove();
    this.imagePickers.clear();
    cancelImageResizes(); closeImageZooms(); clearImageSources();
  }

  private pickImages(editor: Editor, info: Info) {
    const initialFile = info.file;
    const initialText = editor.getValue();
    const from = editor.getCursor('from');
    const to = editor.getCursor('to');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp,image/svg+xml';
    input.multiple = true;
    input.hidden = true;
    const cleanup = () => { input.remove(); this.imagePickers.delete(input); };
    input.addEventListener('cancel', cleanup, { once: true });
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      cleanup();
      if (!this.alive || !files.length) return;
      if (info.file !== initialFile || editor.getValue() !== initialText) {
        new Notice('笔记已切换或内容已改变，请在目标位置重新选择图片。'); return;
      }
      void this.insert(files, editor, info, from, to);
    }, { once: true });
    // Attach the input before opening it, keeping the native mobile picker in this tap.
    this.imagePickers.add(input);
    document.body.append(input);
    try { input.click(); }
    catch { cleanup(); new Notice('无法打开图片选择器，请重试。'); }
  }

  private startImageResize = (image: HTMLImageElement, position: number) => this.beginImageResize(image, position);

  private beginImageResize(image: HTMLImageElement, position?: number | { line: number }): ResizeCommit | null {
    const owner = this.app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view)
      .find(view => view instanceof MarkdownView && view.containerEl.contains(image)) as MarkdownView | undefined;
    if (!owner?.file) return null;
    const file = owner.file;
    const alt = image.alt, url = originalImageSource(image);
    const snapshot = owner.getMode() === 'source' ? Promise.resolve(owner.editor.getValue()) : this.app.vault.cachedRead(file);
    return async width => {
      const original = await snapshot;
      if (!this.alive || owner.file !== file) return;
      if (owner.getMode() !== 'source') {
        await owner.leaf.setViewState({ type: 'markdown', state: { file: file.path, mode: 'source', source: false } });
      }
      const view = owner.leaf.view;
      if (!(view instanceof MarkdownView) || view.file !== file) return;
      const editor = view.editor;
      if (editor.getValue() !== original) { new Notice('笔记内容已变化，请重新调整图片大小。'); return; }
      const near = typeof position === 'number' ? position
        : position ? editor.posToOffset({ line: position.line, ch: 0 }) : undefined;
      const range = imageDeletionRange(original, alt, url, near);
      const change = range && imageWidthChange(original, range, width);
      if (!change) { new Notice('无法定位图片，请重新打开笔记后再调整大小。'); return; }
      if (original.slice(change.from, change.to) === change.insert) return;
      editor.replaceRange(change.insert, editor.offsetToPos(change.from), editor.offsetToPos(change.to), 'inline-images-resize');
      editor.focus();
    };
  }

  private startImageMove = (event: DragEvent, image: HTMLImageElement, position?: number) => {
    const view = this.app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view)
      .find(view => view instanceof MarkdownView && view.containerEl.contains(image)) as MarkdownView | undefined;
    if (!view?.file || view.getMode() !== 'source' || !event.dataTransfer) {
      event.preventDefault(); new Notice('请切换到编辑模式后拖动图片。'); return;
    }
    const text = view.editor.getValue();
    const range = imageDeletionRange(text, image.alt, originalImageSource(image), position);
    if (!range) { event.preventDefault(); return; }
    const token = crypto.randomUUID();
    this.imageMove = { token, path: view.file.path, text, ...range };
    event.dataTransfer.clearData();
    event.dataTransfer.setData(IMAGE_MOVE_TYPE, token);
    event.dataTransfer.effectAllowed = 'move';
    image.addEventListener('dragend', () => {
      if (this.imageMove?.token === token) this.imageMove = undefined;
    }, { once: true });
  };

  private dropImageMove(event: DragEvent, editor: Editor, info: Info, destination: number): boolean {
    const token = event.dataTransfer?.getData(IMAGE_MOVE_TYPE);
    if (!token) return false;
    event.preventDefault();
    const move = this.imageMove;
    this.imageMove = undefined;
    if (!move || move.token !== token || info.file?.path !== move.path) {
      new Notice('目前支持在同一篇笔记内移动图片。'); return true;
    }
    const text = editor.getValue();
    if (text !== move.text) { new Notice('拖动期间笔记内容已变化，请重试。'); return true; }
    const plan = planImageMove(text, move, destination);
    if (!plan) return true;
    editor.transaction({ changes: plan.changes.map(change => ({
      from: editor.offsetToPos(change.from), to: editor.offsetToPos(change.to), text: change.insert,
    })) }, 'inline-images-move');
    editor.setCursor(editor.offsetToPos(plan.cursor));
    editor.focus();
    return true;
  }

  private handleEvent(event: ClipboardEvent | DragEvent, files: File[], editor: Editor, info: Info,
    position?: ReturnType<Editor['getCursor']>) {
    if (!files.some(f => imageMime(f))) return;
    // Prevent the core attachment handler synchronously, before any asynchronous read.
    event.preventDefault();
    if (files.some(f => !imageMime(f))) {
      new Notice('请把图片和其他文件分开插入，本次没有保存附件。');
      return;
    }
    const from = position ?? editor.getCursor('from');
    const to = position ?? editor.getCursor('to');
    void this.insert(files, editor, info, from, to);
  }

  private async insert(files: File[], editor: Editor, info: Info,
    from: ReturnType<Editor['getCursor']>, to: ReturnType<Editor['getCursor']>) {
    if (!files.length) return;
    if (this.busy.has(editor)) { new Notice('上一批图片仍在读取，请稍后再插入。'); return; }
    const file = info.file;
    if (!file || file.extension !== 'md') { new Notice('请先打开一篇 Markdown 笔记。'); return; }
    const originalText = editor.getValue();
    this.busy.add(editor);
    const progress = new Notice(this.settings.compress ? '正在压缩并嵌入图片…' : '正在嵌入图片…', 0);
    try {
      let originalBytes = 0;
      let outputBytes = 0;
      const options = { enabled: this.settings.compress, quality: this.settings.quality,
        maxDimension: this.settings.maxDimension };
      const markdown = await encodeImages(files, this.settings.maxMiB, async file => {
        const result = await compressImage(file, options);
        originalBytes += file.size;
        outputBytes += result.size;
        return result;
      });
      if (!this.alive) return;
      // An editor can be reused for another file. Never write into a changed document.
      if (info.file !== file || editor.getValue() !== originalText) {
        new Notice('读取图片时笔记已切换或内容已改变，请重新插入。图片没有写入其他笔记。', 7000);
        return;
      }
      editor.replaceRange(`\n\n${markdown}\n\n`, from, to);
      const saved = originalBytes - outputBytes;
      const summary = saved > 0 ? `图片体积减少 ${Math.round(saved / originalBytes * 100)}%。`
        : '图片保留原样。';
      new Notice(`已将 ${files.length} 张图片存入笔记。${summary}没有创建图片附件。`, 6000);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : '插入失败，请重新选择图片。', 7000);
    } finally { progress.hide(); this.busy.delete(editor); }
  }

  async saveSettings() { await this.saveData(this.settings); }

  async setPreview(enabled: boolean) {
    this.settings.preview = enabled;
    await this.saveSettings();
    this.previewExtensions.splice(0, this.previewExtensions.length, ...(enabled ? [imagePreview(this.startImageMove, this.startImageResize)] : []));
    // Public plugin API refreshes registered extensions, including detached windows.
    this.app.workspace.updateOptions();
  }
}

class InlineImagesSettings extends PluginSettingTab {
  constructor(private plugin: InlineImages) { super(plugin.app, plugin); }
  display() {
    const { containerEl, plugin } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: '图片存进笔记' });
    containerEl.createEl('p', { text: '图片先在本机压缩，再保存在 .md 内，不会上传。只在压缩结果更小时采用，不自动处理已有图片。' });
    new Setting(containerEl).setName('导入时自动压缩').setDesc('默认开启。GIF、SVG、AVIF 和检测到的动画保留原样；压缩失败时也保留原图。')
      .addToggle(t => t.setValue(plugin.settings.compress).onChange(async value => {
        plugin.settings.compress = value; await plugin.saveSettings();
      }));
    new Setting(containerEl).setName('压缩画质').setDesc('默认 90%，偏向保留细节；PNG 截图至少使用 95%。百分比为编码参数，不是画质保留比例。')
      .addSlider(s => s.setLimits(70, 100, 1).setValue(Math.round(plugin.settings.quality * 100))
        .setDynamicTooltip().onChange(async value => {
          plugin.settings.quality = value / 100; await plugin.saveSettings();
        }));
    new Setting(containerEl).setName('图片最长边').setDesc('默认 3200 像素；小图不会放大。可选保留原始尺寸。')
      .addDropdown(d => d.addOptions({ '0': '保留原始尺寸', '2560': '2560 像素', '3200': '3200 像素（推荐）', '4096': '4096 像素' })
        .setValue(String(plugin.settings.maxDimension)).onChange(async value => {
          plugin.settings.maxDimension = Number(value); await plugin.saveSettings();
        }));
    new Setting(containerEl).setName('接管图片粘贴').addToggle(t => t
      .setValue(plugin.settings.paste).onChange(async value => {
        plugin.settings.paste = value; await plugin.saveSettings();
      }));
    new Setting(containerEl).setName('接管图片拖入').addToggle(t => t
      .setValue(plugin.settings.drop).onChange(async value => {
        plugin.settings.drop = value; await plugin.saveSettings();
      }));
    new Setting(containerEl).setName('折叠编码并显示图片')
      .setDesc('编辑视图中用图片代替长编码。关闭后可查看和编辑原始 Markdown。')
      .addToggle(t => t.setValue(plugin.settings.preview).onChange(async value => {
        await plugin.setPreview(value);
      }));
    new Setting(containerEl).setName('单张图片上限（MB）').setDesc('1–50 MB；默认 10 MB。一次总量最多 40 MB。')
      .addText(t => t.setValue(String(plugin.settings.maxMiB)).onChange(async value => {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 1 || n > 50) { new Notice('请输入 1 到 50 之间的数字。'); return; }
        plugin.settings.maxMiB = n; await plugin.saveSettings();
      }));
  }
}
