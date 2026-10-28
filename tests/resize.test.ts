import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageMarkdown, embeddedImages, imageWidthChange, parseImageBlock } from '../src/core.ts';

test('调整大小仅修改元数据，图片编码和周围文字逐字保留', () => {
  const url = 'data:image/jpeg;base64,' + Buffer.alloc(1024 * 1024, 42).toString('base64');
  const block = imageMarkdown('photo.jpg', url);
  const text = 'before\n\n' + block + '\n\nafter';
  const range = { from: text.indexOf('```inline-image'), to: text.lastIndexOf('```') + 3 };
  const change = imageWidthChange(text, range, 285.7)!;
  assert.ok(change.to - change.from < 200);
  const resized = text.slice(0, change.from) + change.insert + text.slice(change.to);
  const image = [...embeddedImages(resized)][0];
  assert.equal(image.width, 286);
  assert.equal(image[2], url);
  assert.ok(resized.startsWith('before\n\n'));
  assert.ok(resized.endsWith('\n\nafter'));
  assert.equal(text.slice(change.to), resized.slice(change.from + change.insert.length));
  const reset = imageWidthChange(resized, { from: range.from, to: resized.lastIndexOf('```') + 3 })!;
  const original = resized.slice(0, reset.from) + reset.insert + resized.slice(reset.to);
  assert.equal(original, text);
});

test('旧图片无尺寸仍兼容，无效尺寸不会破坏图片数据', () => {
  const old = '{"name":"a.png","mime":"image/png"}\nYQ==';
  assert.equal(parseImageBlock(old)?.width, undefined);
  const block = imageMarkdown('a.png', 'data:image/png;base64,YQ==');
  assert.equal(imageWidthChange(block, { from: 0, to: block.length }, NaN), null);
  const change = imageWidthChange(block, { from: 0, to: block.length }, 1)!;
  assert.equal(JSON.parse(change.insert).width, 64);
});
