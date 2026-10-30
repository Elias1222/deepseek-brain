const fs = require('fs');
const t = fs.readFileSync('web/vendor/three.global.min.js', 'utf8');
const m = t.match(/REVISION\s*=\s*['"]([^'"]+)/);
const m2 = t.match(/"(\d{3})"/);
console.log('rev', m && m[1], 'guess', m2 && m2[1], 'size', t.length);
console.log('ColorManagement', t.includes('ColorManagement'), 'SRGBColorSpace', t.includes('SRGBColorSpace'));
const files = fs.readdirSync('dist');
console.log('dist', files.join(','));
