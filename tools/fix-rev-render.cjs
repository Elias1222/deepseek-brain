const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');

const chipOld = `        APP.viewVer = v;
        renderGauges();`;
const chipNew = `        APP.viewVer = v;
        renderBoard();`;
if (!t.includes(chipOld)) { console.error('MISS chip'); process.exit(1); }
t = t.replace(chipOld, chipNew);

const loadOld = `      if (APP.viewVer != null && !res.versions.some(function (x) { return x.v === APP.viewVer; })) APP.viewVer = null;
      renderGauges();`;
const loadNew = `      if (APP.viewVer != null && !res.versions.some(function (x) { return x.v === APP.viewVer; })) APP.viewVer = null;
      renderBoard();`;
if (!t.includes(loadOld)) { console.error('MISS load'); process.exit(1); }
t = t.replace(loadOld, loadNew);

fs.writeFileSync(p, t);
console.log('ok', t.length);
