import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { unlink } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { encodeImages, embeddedImages, imageMime, imageMarkdown, validateFiles, imageDeletionRange, IMAGE_DATA_LINE_LENGTH } from '../src/core.ts';
import { imagePreview } from '../src/preview.ts';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, File: dom.window.File,
  FileReader: dom.window.FileReader, MutationObserver: dom.window.MutationObserver,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  __notices: [],
});
// A valid transparent 1×1 PNG, whose original bytes must be preserved.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64');
const image = (name = '截图.png') => new File([png], name, { type: 'image/png' });
const temporaryBundle = new URL('./.plugin-test.cjs', import.meta.url);
await build({
  entryPoints: ['src/main.ts'], bundle: true, platform: 'node', format: 'cjs',
  outfile: temporaryBundle.pathname,
  external: ['@codemirror/state', '@codemirror/view', '@codemirror/language'],
  alias: { obsidian: new URL('./obsidian-mock.ts', import.meta.url).pathname },
});
const Plugin = createRequire(import.meta.url)(temporaryBundle.pathname).default;
await unlink(temporaryBundle);

async function harness() {
  (globalThis as any).__notices = [];
  const app = { workspace: { on: (name: string, callback: any) => ({ name, callback }), updateOptions() {} } };
  const plugin = new Plugin(app);
  await plugin.onload();
  const writes: any[] = [];
  const editor = {
    text: '原始笔记', getValue() { return this.text; },
    getCursor() { return { line: 0, ch: 4 }; },
    posToOffset(position: { line: number; ch: number }) {
      return this.text.split('\n').slice(0, position.line).reduce((n, line) => n + line.length + 1, 0) + position.ch;
    },
    offsetToPos(offset: number) {
      const lines = this.text.slice(0, offset).split('\n');
      return { line: lines.length - 1, ch: lines[lines.length - 1].length };
    },
    replaceRange(text: string, from: any, to: any) {
      writes.push({ text, from, to }); this.text += text;
    },
  };
  const info = { file: { path: '测试.md', extension: 'md' } };
  const event = (files: File[]) => ({
    defaultPrevented: false, clipboardData: { files }, dataTransfer: { files, getData: () => '', types: [] },
    preventDefault() { this.defaultPrevented = true; },
  });
  return { plugin, editor, info, event, writes };
}
const settle = async () => {
  for (let i = 0; i < 40; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    if ((globalThis as any).__notices.some((text: string) => !text.startsWith('正在'))) break;
  }
};

test('图片字节完整存入 Markdown，多图顺序保持一致', async () => {
  const result = await encodeImages([image('第一张.png'), image('第二张.png')], 10);
  const matches = [...embeddedImages(result)];
  assert.equal(matches.length, 2);
  assert.equal(matches[0][1], '第一张.png');
  assert.equal(matches[1][1], '第二张.png');
  assert.deepEqual(Buffer.from(matches[0][2].split(',')[1], 'base64'), png);
});

test('文件名中的 Markdown 字符和换行不会破坏图片语法', () => {
  const result = imageMarkdown('a]\\\n[.png', 'data:image/png;base64,YQ==');
  assert.equal([...embeddedImages(result)].length, 1);
  assert.ok(result.split('\n').every(line => line.length <= IMAGE_DATA_LINE_LENGTH));
});

test('空 MIME 按扩展名识别，拒绝非图片、空文件及超限图片', () => {
  assert.equal(imageMime({ name: 'A.JPG', type: '' }), 'image/jpeg');
  assert.equal(imageMime({ name: 'a.png', type: 'text/plain' }), null);
  assert.throws(() => validateFiles([new File([], 'empty.png', { type: 'image/png' })], 10));
  assert.throws(() => validateFiles([new File([new Uint8Array(1024 * 1024 + 1)], 'big.png', { type: 'image/png' })], 1));
  assert.throws(() => validateFiles([new File(['x'], 'x.txt', { type: 'text/plain' })], 10));
  assert.throws(() => validateFiles(Array.from({ length: 5 }, () => ({ name: 'x.png', type: 'image/png', size: 9 * 1024 * 1024 }) as File), 10));
});

test('粘贴同步阻止默认附件行为，异步读取后一次写入所有图片', async () => {
  const h = await harness();
  const event = h.event([image(), image('2.png')]);
  h.plugin.events.get('editor-paste')(event, h.editor, h.info);
  assert.equal(event.defaultPrevented, true);
  await settle();
  assert.equal(h.writes.length, 1);
  assert.equal([...embeddedImages(h.writes[0].text)].length, 2);
});

test('读取期间切换笔记或修改正文，不写入错误位置', async () => {
  for (const change of ['file', 'text']) {
    const h = await harness();
    h.plugin.events.get('editor-paste')(h.event([image()]), h.editor, h.info);
    if (change === 'file') h.info.file = { path: '另一篇.md', extension: 'md' };
    else h.editor.text = '编辑后的正文';
    await settle();
    assert.equal(h.writes.length, 0);
    assert.ok((globalThis as any).__notices.some((text: string) => /已切换或内容已改变/.test(text)));
  }
});

test('混合文件不创建附件，普通文字事件保持原有行为', async () => {
  const h = await harness();
  const mixed = h.event([image(), new File(['x'], 'x.txt', { type: 'text/plain' })]);
  h.plugin.events.get('editor-paste')(mixed, h.editor, h.info);
  assert.equal(mixed.defaultPrevented, true);
  assert.equal(h.writes.length, 0);
  const text = h.event([]);
  h.plugin.events.get('editor-paste')(text, h.editor, h.info);
  assert.equal(text.defaultPrevented, false);
});

test('拖入、关闭接管、卸载时的行为', async () => {
  const h = await harness();
  const dropped = h.event([image()]);
  h.plugin.events.get('editor-drop')(dropped, h.editor, h.info);
  await settle();
  assert.equal(dropped.defaultPrevented, true);
  assert.equal(h.writes.length, 1);
  h.plugin.settings.paste = false;
  const disabled = h.event([image()]);
  h.plugin.events.get('editor-paste')(disabled, h.editor, h.info);
  assert.equal(disabled.defaultPrevented, false);
  const other = await harness();
  other.plugin.events.get('editor-paste')(other.event([image()]), other.editor, other.info);
  other.plugin.onunload();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(other.writes.length, 0);
});

test('预览把编码替换成图片，编辑后重算，删除后不残留装饰', async () => {
  const markdown = await encodeImages([image()], 10);
  const field = imagePreview();
  let state = EditorState.create({ doc: markdown, extensions: [field] });
  assert.equal(state.field(field).size, 1);
  let widget: any;
  state.field(field).between(0, state.doc.length, (_from, _to, value) => { widget = value.spec.widget; });
  const element = widget.toDOM({ dom: document.body, requestMeasure() {} } as EditorView);
  assert.equal(element.querySelectorAll('img').length, 1);
  assert.equal(element.textContent, '删除图片');
  state = state.update({ changes: { from: 0, to: state.doc.length, insert: '正文' } }).state;
  assert.equal(state.field(field).size, 0);
});

test('预览设置使用可更新扩展数组', async () => {
  const h = await harness();
  assert.equal(h.plugin.extensions[0].length, 1);
  await h.plugin.setPreview(false);
  assert.equal(h.plugin.extensions[0].length, 0);
  await h.plugin.setPreview(true);
  assert.equal(h.plugin.extensions[0].length, 1);
});

test('多兆图片分行存储，附近连续增删复用原有图片装饰', () => {
  const payload = Buffer.alloc(3 * 1024 * 1024, 42).toString('base64');
  const block = imageMarkdown('large.jpg', `data:image/jpeg;base64,${payload}`);
  assert.ok(block.split('\n').every(line => line.length <= IMAGE_DATA_LINE_LENGTH));
  assert.equal([...embeddedImages(block)][0][2].split(',')[1], payload);
  const field = imagePreview();
  let state = EditorState.create({ doc: 'before\n\n' + block + '\n\nafter', extensions: [field] });
  let initialWidget: any;
  state.field(field).between(0, state.doc.length, (_from, _to, value) => { initialWidget = value.spec.widget; });
  const start = performance.now();
  for (let i = 0; i < 200; i++) {
    state = state.update({ changes: { from: 0, insert: 'x' } }).state;
    state = state.update({ changes: { from: 0, to: 1, insert: '' } }).state;
  }
  const elapsed = performance.now() - start;
  assert.equal(state.field(field).size, 1);
  state.field(field).between(0, state.doc.length, (_from, _to, value) => { assert.equal(value.spec.widget, initialWidget); });
  assert.ok(elapsed < 2000, `400 edits took ${elapsed} ms`);
});

test('同一张图出现多次时只删除指定位置，保留周围文字', () => {
  const url = 'data:image/png;base64,YQ==';
  const block = imageMarkdown('a.png', url);
  const text = 'before\n\n' + block + '\n\nmiddle\n\n' + block + '\n\nafter';
  assert.equal(imageDeletionRange(text, 'a.png', url), null);
  const second = text.lastIndexOf('```inline-image');
  const range = imageDeletionRange(text, 'a.png', url, second)!;
  assert.equal(range.from, second);
  const result = text.slice(0, range.from) + text.slice(range.to);
  assert.equal([...embeddedImages(result)].length, 1);
  assert.ok(result.startsWith('before\n\n' + block));
  assert.ok(result.includes('middle'));
  assert.ok(result.endsWith('after'));
  assert.equal(imageDeletionRange(text, 'a.png', url, 0), null);
});

test('快捷菜单入口直接打开已挂载的选图器，选择图片后复用内嵌流程', async () => {
  const h = await harness();
  h.plugin.app.workspace.getActiveViewOfType = () => ({ ...h.info, editor: h.editor, getMode: () => 'source' });
  const originalClick = dom.window.HTMLInputElement.prototype.click;
  let clicked: HTMLInputElement | undefined;
  dom.window.HTMLInputElement.prototype.click = function () { clicked = this as unknown as HTMLInputElement; };
  try {
    assert.equal(h.plugin.ribbons[0].icon, 'image-plus');
    assert.equal(h.plugin.ribbons[0].title, '添加图片到笔记');
    h.plugin.ribbons[0].callback();
    assert.ok(clicked?.isConnected);
    assert.equal(clicked!.type, 'file');
    assert.equal(clicked!.multiple, true);
    Object.defineProperty(clicked!, 'files', { value: [image()] });
    clicked!.dispatchEvent(new dom.window.Event('change'));
    await settle();
    assert.equal(clicked!.isConnected, false);
    assert.equal(h.writes.length, 1);
    assert.equal([...embeddedImages(h.writes[0].text)].length, 1);
  } finally { dom.window.HTMLInputElement.prototype.click = originalClick; }
});

test('快捷菜单在无笔记或阅读模式下提示，不打开选图器', async () => {
  const h = await harness();
  h.plugin.app.workspace.getActiveViewOfType = () => null;
  h.plugin.ribbons[0].callback();
  assert.match((globalThis as any).__notices.at(-1), /请先打开/);
  h.plugin.app.workspace.getActiveViewOfType = () => ({ ...h.info, editor: h.editor, getMode: () => 'preview' });
  h.plugin.ribbons[0].callback();
  assert.match((globalThis as any).__notices.at(-1), /编辑模式/);
  assert.equal(document.querySelector('input[type="file"]'), null);
});

test('命令和快捷菜单共用选图保护，取消、改动正文和卸载后清理控件', async () => {
  const h = await harness();
  const originalClick = dom.window.HTMLInputElement.prototype.click;
  dom.window.HTMLInputElement.prototype.click = function () {};
  const command = h.plugin.commands.find((command: any) => command.id === 'insert-images');
  try {
    command.editorCallback(h.editor, h.info);
    let input = document.querySelector('input[type="file"]') as HTMLInputElement;
    input.dispatchEvent(new dom.window.Event('cancel'));
    assert.equal(input.isConnected, false);
    command.editorCallback(h.editor, h.info);
    input = document.querySelector('input[type="file"]') as HTMLInputElement;
    h.editor.text = '选图期间改动的正文';
    Object.defineProperty(input, 'files', { value: [image()] });
    input.dispatchEvent(new dom.window.Event('change'));
    assert.equal(h.writes.length, 0);
    assert.equal(input.isConnected, false);
    assert.match((globalThis as any).__notices.at(-1), /已切换或内容已改变/);
    command.editorCallback(h.editor, h.info);
    h.plugin.onunload();
    assert.equal(document.querySelector('input[type="file"]'), null);
  } finally { dom.window.HTMLInputElement.prototype.click = originalClick; }
});
