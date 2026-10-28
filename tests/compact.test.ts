import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactImageBlocks, embeddedImages } from '../src/core.ts';

test('减少图片数据行数，保持图片字节、尺寸、元数据和周围文字', () => {
  const payload = Buffer.alloc(400000, 42).toString('base64');
  for (const eol of ['\n', '\r\n']) {
    const header = '{ "name": "a.jpg", "mime": "image/jpeg", "width": 285, "custom": true }';
    const text = ['before', '', '```inline-image', header, ...(payload.match(/.{1,120}/g)!), '```', '', 'after'].join(eol);
    const result = compactImageBlocks(text);
    assert.equal(result.changed, 1);
    assert.ok(result.text.includes(header));
    assert.ok(result.text.startsWith('before' + eol + eol));
    assert.ok(result.text.endsWith(eol + eol + 'after'));
    const image = [...embeddedImages(result.text)][0];
    assert.equal(image[2], 'data:image/jpeg;base64,' + payload);
    assert.equal(image.width, 285);
    assert.ok(result.text.split(eol).length < text.split(eol).length / 20);
    assert.equal(compactImageBlocks(result.text).changed, 0);
  }
});
