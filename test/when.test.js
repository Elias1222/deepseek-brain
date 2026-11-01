import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWhen } from '../lib/extract.js';

const AT = new Date('2026-11-01T10:00:00').getTime(); // 周日 10:00

const iso = (text) => {
  const out = parseWhen(text, AT);
  return out ? new Date(out.at).toLocaleString('sv-SE').slice(0, 16) : null;
};

test('relative days resolve from the given instant', () => {
  assert.equal(iso('今天'), '2026-11-01 00:00');
  assert.equal(iso('明天'), '2026-11-02 00:00');
  assert.equal(iso('后天'), '2026-11-03 00:00');
  assert.equal(iso('昨天'), '2026-10-31 00:00');
});

test('a weekday keyword lands on that day of next week', () => {
  assert.equal(iso('下周三评审'), '2026-11-04 00:00');
  assert.equal(iso('这周五'), '2026-11-06 00:00');
});

test('month boundaries and explicit dates', () => {
  assert.equal(iso('月底交稿'), '2026-11-30 00:00');
  assert.equal(iso('月初'), '2026-11-01 00:00');
  assert.equal(iso('下个月搬去上海'), '2026-12-01 00:00');
  assert.equal(iso('3 月 7 号是生日'), '2027-03-07 00:00');
});

test('chinese clock time respects the period of day', () => {
  assert.equal(iso('明天下午三点和张伟开会'), '2026-11-02 15:00');
  assert.equal(iso('下周三上午十点半评审'), '2026-11-04 10:30');
  assert.equal(iso('晚上八点跑步'), '2026-11-01 20:00');
  assert.equal(iso('中午十二点吃饭'), '2026-11-01 12:00');
});

test('digits work too and the label keeps the whole phrase', () => {
  const out = parseWhen('19:30 打电话', AT);
  assert.equal(new Date(out.at).toLocaleString('sv-SE').slice(0, 16), '2026-11-01 19:30');
  assert.equal(out.label, '19:30');
});

test('no time phrase means null, never "now"', () => {
  assert.equal(parseWhen('我喜欢黑咖啡', AT), null);
  assert.equal(parseWhen('', AT), null);
});
