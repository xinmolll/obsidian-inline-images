import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { compressImage, DEFAULT_COMPRESSION, isAnimated, keepSmaller, scaledDimensions } from '../src/compression.ts';
const dom = new JSDOM();
Object.assign(globalThis, { File: dom.window.File, FileReader: dom.window.FileReader });

test('压缩默认高画质，保持宽高比且不会放大小图', () => {
  assert.equal(DEFAULT_COMPRESSION.quality, 0.9);
  assert.deepEqual(scaledDimensions(6000, 4000, 3200), { width: 3200, height: 2133 });
  assert.deepEqual(scaledDimensions(800, 1200, 3200), { width: 800, height: 1200 });
  assert.deepEqual(scaledDimensions(6000, 4000, 0), { width: 6000, height: 4000 });
});
test('变大或空结果采用原图，只有更小时才使用压缩结果', () => {
  const original = new File(['12345'], 'a.jpg', { type: 'image/jpeg' });
  const smaller = new File(['123'], 'b.jpg', { type: 'image/jpeg' });
  assert.equal(keepSmaller(original, smaller), smaller);
  assert.equal(keepSmaller(original, new File(['123456'], 'b.jpg')), original);
  assert.equal(keepSmaller(original, new File([], 'b.jpg')), original);
});
test('检测 APNG 和 WebP 动画标记，不把普通图片识别为动画', () => {
  const png = Buffer.alloc(28);
  png.writeUInt32BE(8, 8); png.write('acTL', 12);
  assert.equal(isAnimated(png, 'image/png'), true);
  png.write('IDAT', 12);
  assert.equal(isAnimated(png, 'image/png'), false);
  const webp = Buffer.alloc(30);
  webp.write('VP8X', 12); webp.writeUInt32LE(10, 16); webp[20] = 2;
  assert.equal(isAnimated(webp, 'image/webp'), true);
  webp[20] = 0;
  assert.equal(isAnimated(webp, 'image/webp'), false);
});
test('关闭压缩、动画和矢量文件保持原始对象；环境不支持时回退原图', async () => {
  const jpeg = new File(['jpeg'], 'a.jpg', { type: 'image/jpeg' });
  assert.equal(await compressImage(jpeg, { ...DEFAULT_COMPRESSION, enabled: false }), jpeg);
  for (const type of ['image/gif', 'image/svg+xml', 'image/avif']) {
    const file = new File(['image'], 'image', { type });
    assert.equal(await compressImage(file, DEFAULT_COMPRESSION), file);
  }
  assert.equal(await compressImage(jpeg, DEFAULT_COMPRESSION), jpeg);
});
