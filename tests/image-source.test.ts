import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { bindImageSource, originalImageSource, clearImageSources } from '../src/image-source.ts';

test('DOM 使用短地址，同图共用缓存，最后一个预览销毁才释放', () => {
  const dom = new JSDOM();
  let created = 0;
  const revoked: string[] = [];
  dom.window.URL.createObjectURL = () => 'blob:qa/' + ++created;
  dom.window.URL.revokeObjectURL = url => { revoked.push(url); };
  const a = dom.window.document.createElement('img'), b = dom.window.document.createElement('img');
  const data = 'data:image/png;base64,YQ==';
  const releaseA = bindImageSource(a, data), releaseB = bindImageSource(b, data);
  assert.equal(created, 1);
  assert.equal(a.src, 'blob:qa/1');
  assert.equal(originalImageSource(a), data);
  releaseA(); releaseA();
  assert.equal(revoked.length, 0);
  releaseB();
  assert.deepEqual(revoked, ['blob:qa/1']);
  clearImageSources();
  assert.equal(revoked.length, 1);
});

test('不支持内存地址时回退原格式，插件卸载释放缓存', () => {
  const dom = new JSDOM();
  const image = dom.window.document.createElement('img');
  const data = 'data:image/png;base64,YQ==';
  const fallback = bindImageSource(image, data);
  assert.equal(image.src, data);
  fallback();
  let revoked = 0;
  dom.window.URL.createObjectURL = () => 'blob:qa/2';
  dom.window.URL.revokeObjectURL = () => { revoked++; };
  const release = bindImageSource(image, data);
  clearImageSources(); release();
  assert.equal(revoked, 1);
});

test('旧预览延迟销毁不会移除新加载的缓存', () => {
  const dom = new JSDOM();
  let created = 0;
  const revoked: string[] = [];
  dom.window.URL.createObjectURL = () => 'blob:qa/' + ++created;
  dom.window.URL.revokeObjectURL = url => { revoked.push(url); };
  const data = 'data:image/png;base64,YQ==';
  const oldRelease = bindImageSource(dom.window.document.createElement('img'), data);
  clearImageSources();
  const newRelease = bindImageSource(dom.window.document.createElement('img'), data);
  oldRelease();
  clearImageSources();
  assert.deepEqual(revoked, ['blob:qa/1', 'blob:qa/2']);
  newRelease();
  assert.equal(revoked.length, 2);
});
