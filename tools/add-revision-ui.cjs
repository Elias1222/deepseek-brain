const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');

/* ── A. 样式：版本条与版本详情 ── */
const cssAnchor = '.e-orig{margin:0 0 10px;padding:9px 10px 8px 11px;border-left:1px solid var(--c);';
if (!t.includes(cssAnchor)) { console.error('MISS css'); process.exit(1); }
const css = `/* 修订史：v1 … vN 的链条，点开看那一版到底写了什么 */
.rev{margin:8px 0 10px}
.rev-head{display:flex;align-items:baseline;gap:6px;font-family:var(--mono);font-size:9px;
  letter-spacing:.16em;color:var(--bone-40);text-transform:uppercase}
.rev-head b{font-weight:400;color:var(--bone-60);letter-spacing:.1em}
.rev-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.rev-chip{font-family:var(--mono);font-size:9.5px;letter-spacing:.08em;padding:2px 7px;border:1px solid #24282a;
  background:none;color:var(--bone-60);cursor:pointer;transition:border-color .15s,color .15s}
.rev-chip:hover{border-color:var(--c);color:var(--bone)}
.rev-chip.on{border-color:var(--c);color:var(--bone);background:rgba(255,255,255,.03)}
.rev-chip .st{opacity:.55;margin-left:4px}
.rev-box{margin-top:6px;padding:7px 9px;border:1px dashed #262a2c;font-family:var(--mono);font-size:10px;
  line-height:1.72;color:var(--bone-60)}
.rev-box dl{display:grid;grid-template-columns:74px 1fr;gap:2px 8px;margin:0}
.rev-box dt{color:var(--bone-40);font-size:9px;letter-spacing:.1em;text-transform:uppercase}
.rev-box dd{margin:0;color:var(--bone);word-break:break-word}
.rev-box .note{font-family:var(--serif);color:var(--bone-40);font-size:9.5px;margin-top:6px;line-height:1.7}
.rev-box .mini{margin-top:6px}
`;
t = t.replace(cssAnchor, css + cssAnchor);

/* ── B. 逻辑：取版本链、渲染版本条、恢复某一版 ── */
const jsAnchor = '  function selectEngram(rec) {';
if (!t.includes(jsAnchor)) { console.error('MISS js anchor'); process.exit(1); }
const js = `  /* 版本链：按 id 取一次，之后只在该条被编辑时失效 */
  function loadHistory(rec) {
    if (!rec) return;
    if (!APP.history) APP.history = {};
    var cached = APP.history[rec.id];
    if (cached && cached.at === rec.editedAt) return;
    APP.history[rec.id] = { at: rec.editedAt, versions: [{ v: 1, ts: rec.ts, fields: rec.raw && rec.raw.history ? null : null, current: true, status: 'current' }] };
    if (!APP.live) return;
    apiGet('api/memories/' + encodeURIComponent(rec.id)).then(function (res) {
      if (!res || !res.versions || !res.versions.length) return;
      APP.history[rec.id] = { at: rec.editedAt, versions: res.versions };
      renderGauges();
    }).catch(function () { /* 端点不可用时静默退化成「只有当前版」 */ });
  }

  function revisionHTML(rec) {
    var bag = (APP.history && APP.history[rec.id]) || null;
    var versions = bag ? bag.versions : [];
    if (!versions.length) return '';
    var view = APP.viewVer == null ? versions[versions.length - 1].v : APP.viewVer;
    var shown = versions.filter(function (x) { return x.v === view; })[0] || versions[versions.length - 1];
    var chips = versions.map(function (x) {
      var cls = 'rev-chip' + (x.v === shown.v ? ' on' : '');
      var st = x.current ? '当前' : (x.status === 'corrected' ? '已修正' : '');
      return '<button class="' + cls + '" data-ver="' + x.v + '">v' + x.v +
        (st ? '<span class="st">' + st + '</span>' : '') + '</button>';
    }).join('');
    var rows = Object.keys(shown.fields || {}).filter(function (k) {
      var v = shown.fields[k];
      return v !== '' && v != null && !(Array.isArray(v) && !v.length);
    }).map(function (k) {
      var v = shown.fields[k];
      return '<dt>' + escapeHTML(k) + '</dt><dd>' + escapeHTML(Array.isArray(v) ? v.join(' / ') : String(v)) + '</dd>';
    }).join('');
    var restore = shown.current ? '' :
      '<button class="mini" data-act="restoreVer" data-ver="' + shown.v + '">恢复此版本</button>';
    return '<div class="rev">' +
      '<div class="rev-head"><b>修订史</b><span>REVISIONS · ' + versions.length + ' 版</span></div>' +
      '<div class="rev-chips">' + chips + '</div>' +
      '<div class="rev-box"><dl>' + rows + '</dl>' +
        '<div class="note">' + (shown.current ? '这是当前生效的版本。'
          : '这是 v' + shown.v + ' 当时的字段；恢复会再压一版，不覆盖历史。') + '</div>' +
        restore + '</div></div>';
  }

  function doRestoreVersion(rec, version) {
    var bag = APP.history && APP.history[rec.id];
    if (!bag) return;
    var shown = bag.versions.filter(function (x) { return x.v === version; })[0];
    if (!shown) return;
    var patch = {};
    Object.keys(shown.fields || {}).forEach(function (k) {
      if (k === 'object') return;
      patch[k] = shown.fields[k];
    });
    var done = function (ok, note) {
      setStatus('restore v' + version + ' · ' + escapeHTML(truncate(rec.id, 16)), ok ? '已恢复为 v' + version : note, ok ? '' : 'warn');
      toast(ok ? ('已恢复 v' + version) : '恢复失败');
      if (!ok) return;
      APP.viewVer = null;
      setTimeout(function () { if (APP.live) refreshState({ quiet: true }); else applyDemoTime(); }, 140);
    };
    if (rec.layer === 'semantic') {
      /* 语义事实的「版本」是记录本身：恢复 = 把它放回生效位 */
      if (!APP.live) { done(false, '离线演示不支持语义回滚'); return; }
      apiPost('api/conflicts/' + encodeURIComponent(shown.id) + '/restore', {})
        .then(function (res) { done(res && res.ok !== false, '拒绝'); })
        .catch(function (err) { done(false, '失败 · ' + String((err && err.code) || 'network')); });
      return;
    }
    if (!APP.live) { done(false, '离线演示不支持回滚'); return; }
    apiPost('api/memories/' + encodeURIComponent(rec.id), patch, 'PATCH')
      .then(function (res) { done(res && res.ok !== false, '拒绝'); })
      .catch(function (err) { done(false, '失败 · ' + String((err && err.code) || 'network')); });
  }

`;
t = t.replace(jsAnchor, js + jsAnchor);

/* ── C. 面板里插入版本条 ── */
const titleAnchor = "        '<h3 class=\"e-title\">' + escapeHTML(rec.title) + '</h3>' +";
if (!t.includes(titleAnchor)) { console.error('MISS title'); process.exit(1); }
t = t.replace(titleAnchor, titleAnchor + "\n        revisionHTML(rec) +");

/* ── D. 绑定版本条点击 ── */
const bindAnchor = `    [].forEach.call(host.querySelectorAll('.mini'), function (b) {`;
if (!t.includes(bindAnchor)) { console.error('MISS bind'); process.exit(1); }
const bind = `    [].forEach.call(host.querySelectorAll('.rev-chip'), function (b) {
      b.addEventListener('click', function () {
        var v = Number(b.getAttribute('data-ver'));
        APP.viewVer = v;
        renderGauges();
      });
    });
`;
t = t.replace(bindAnchor, bind + bindAnchor);

const actAnchor = "        else if (act === 'impdown') doEditImportance(rec, -1);";
if (!t.includes(actAnchor)) { console.error('MISS act'); process.exit(1); }
t = t.replace(actAnchor, actAnchor + "\n        else if (act === 'restoreVer') doRestoreVersion(rec, Number(b.getAttribute('data-ver')));");

/* ── E. 选中一条时去取版本链 ── */
t = t.replace(
  "    setStatus('EYEPIECE · ' + REGION[rec.layer].label, '#' + escapeHTML(rec.id), '');",
  "    setStatus('EYEPIECE · ' + REGION[rec.layer].label, '#' + escapeHTML(rec.id), '');\n    APP.viewVer = null;\n    loadHistory(rec);",
);

fs.writeFileSync(p, t);
console.log('ok', t.length);
