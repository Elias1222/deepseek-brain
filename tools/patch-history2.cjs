const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');
let n = 0;
const sub = (a, b, tag) => { if (!t.includes(a)) { console.error('MISS ' + tag); process.exit(1); } t = t.replace(a, b); n++; };

/* 行尾补命中条数 */
sub(`        '<span class="m">' + (marks || '<i style="background:#4a4842"></i>') + '</span>' +`,
`        '<span class="m">' + (marks || '<i style="background:#4a4842"></i>') +
          '<em>' + it.hits.length + '</em></span>' +`, 'hist-count');

sub('.hist .m { display: flex; gap: 2px; align-items: center; }',
`.hist .m { display: flex; gap: 2px; align-items: center; }
.hist .m em { font: 9px/1 var(--mono); font-style: normal; color: var(--dim, #7c7a70);
  margin-left: 3px; font-variant-numeric: tabular-nums; }
.hist li.on .m em { color: #e0846a; }`, 'hist-count-css');

/* 同一分钟内的多次检索用秒区分 */
sub(`      var hh = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2);`,
`      var sameMin = i > 0 && (function () {
        var pv = new Date(APP.queries[i - 1].at);
        return pv.getHours() === t.getHours() && pv.getMinutes() === t.getMinutes();
      })();
      var hh = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2);
      if (sameMin) hh += ':' + ('0' + t.getSeconds()).slice(-2);`, 'hist-seconds');

fs.writeFileSync(p, t);
console.log('patched', n);
