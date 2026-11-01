const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/dashboard.html';
let t = fs.readFileSync(p, 'utf8');

/* renderDeprecated 返回 promise，便于动作方在渲染完成后再写自己的状态文案 */
const a1 = "  api('api/conflicts').then(function(data){\n    DEPR.groups = data.groups || [];";
const b1 = "  return api('api/conflicts').then(function(data){\n    DEPR.groups = data.groups || [];";
if (!t.includes(a1)) { console.error('MISS render return'); process.exit(1); }
t = t.replace(a1, b1);

/* 动作完成后：先重绘，再写结果文案（否则被默认文案覆写） */
const a2 = `  api('api/conflicts/prune', { method:'POST', body: payload }).then(function(res){
    DEPR.busy = false;
    deprSetStatus('已归档 ' + res.removed + ' 条 · 留档在 archive.json', 'ok');
    renderDeprecated();
    if(typeof refreshState === 'function') refreshState();
  }).catch(function(err){`;
const b2 = `  api('api/conflicts/prune', { method:'POST', body: payload }).then(function(res){
    DEPR.busy = false;
    var note = res.removed
      ? '已归档 ' + res.removed + ' 条 · 留档在 archive.json'
      : '没有可归档的旧版本';
    return Promise.resolve(renderDeprecated()).then(function(){
      deprSetStatus(note, 'ok');
    });
  }).then(function(){
    if(typeof refreshState === 'function') refreshState();
  }).catch(function(err){`;
if (!t.includes(a2)) { console.error('MISS prune then'); process.exit(1); }
t = t.replace(a2, b2);

fs.writeFileSync(p, t);
console.log('ok');
