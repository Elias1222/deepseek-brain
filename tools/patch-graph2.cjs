const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');
let n = 0;
const sub = (a, b, tag) => { if (!t.includes(a)) { console.error('MISS ' + tag); process.exit(1); } t = t.replace(a, b); n++; };

/* 词级相似度更贴合实际输入（查询是用空格分开的词串），并暴露「共同词」 */
sub(`  function queryTokens(q) {
    var s = String(q || '').toLowerCase().replace(/\\s+/g, '');
    var out = {};
    for (var i = 0; i < s.length - 1; i++) out[s.slice(i, i + 2)] = 1;
    if (!s.length) out[s] = 1;
    return out;
  }
  function querySimilar(a, b) {
    var A = queryTokens(a), B = queryTokens(b);
    var ka = Object.keys(A), kb = Object.keys(B);
    if (!ka.length || !kb.length) return 0;
    var hit = 0;
    ka.forEach(function (k) { if (B[k]) hit++; });
    return hit / Math.min(ka.length, kb.length);
  }`,
`  function queryTerms(q) {
    var out = {};
    String(q || '').toLowerCase()
      .split(/[\\s,，、;；/·]+/)
      .forEach(function (w) {
        if (w.length >= 2) out[w] = 1;
        else if (w.length === 1) out[w] = 1;
      });
    return out;
  }
  function querySharedTerms(a, b) {
    var A = queryTerms(a), B = queryTerms(b), out = [];
    Object.keys(A).forEach(function (k) { if (B[k]) out.push(k); });
    return out;
  }
  function querySimilar(a, b) {
    var A = queryTerms(a), B = queryTerms(b);
    var ka = Object.keys(A), kb = Object.keys(B);
    if (!ka.length || !kb.length) return 0;
    var shared = querySharedTerms(a, b).length;
    return shared / Math.min(ka.length, kb.length);
  }`, 'terms');

/* 阈值放到 0.25：只要共享一个实词就算同话题 */
sub(`      if (querySimilar(entry.q, APP.queries[i].q) >= 0.4) { prev = APP.queries[i]; break; }`,
`      if (querySimilar(entry.q, APP.queries[i].q) >= 0.25) { prev = APP.queries[i]; break; }`, 'threshold');

/* 对比行里点出共同词 */
sub(`  function graphDelta(entry, prev) {
    if (!prev) return '<span class="cap">还没有可对比的上一次同话题检索。</span>';`,
`  function graphDelta(entry, prev) {
    if (!prev) return '<span class="cap">还没有可对比的上一次同话题检索。</span>';
    var shared = querySharedTerms(entry.q, prev.q);`, 'delta-shared');

sub(`    return '<span class="cap">对比「' + escapeHTML(truncate(prev.q, 12)) + '」：' +`,
`    return '<span class="cap">对比「' + escapeHTML(truncate(prev.q, 12)) + '」' +
      (shared.length ? '（共同词：' + escapeHTML(shared.join('、')) + '）' : '') + '：' +`, 'delta-render');

fs.writeFileSync(p, t);
console.log('patched', n);
