import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageMarkdown, embeddedImages } from '../src/core.ts';
import { planImageMove } from '../src/move.ts';

test('图片向前或向后移动仅保留一份完整数据，保留其他文本', () => {
  const block = imageMarkdown('a.png', 'data:image/png;base64,YQ==');
  const text = 'before\n\n' + block + '\n\nafter';
  const from = text.indexOf('```inline-image');
  for (const destination of [0, text.length]) {
    const plan = planImageMove(text, { from, to: from + block.length }, destination)!;
    let result = text;
    for (const change of [...plan.changes].reverse()) result = result.slice(0, change.from) + change.insert + result.slice(change.to);
    const matches = [...embeddedImages(result)];
    assert.equal(matches.length, 1);
    assert.equal(matches[0][2], 'data:image/png;base64,YQ==');
    assert.ok(result.includes('before'));
    assert.ok(result.includes('after'));
    assert.ok(plan.cursor <= result.length);
    if (destination === 0) assert.ok(result.indexOf(block) < result.indexOf('before'));
    else assert.ok(result.indexOf(block) > result.indexOf('after'));
  }
  assert.equal(planImageMove(text, { from, to: from + block.length }, from + 1), null);
});
