const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/test/server.test.js';
let t = fs.readFileSync(p, 'utf8');

const anchor = `test('parseAt understands relative, epoch and ISO forms'`;
if (!t.includes(anchor)) { console.error('MISS anchor'); process.exit(1); }

const block = `test('conflicts expose groups and prune archives the surplus', async () => {
  await withServer(async ({ origin }) => {
    for (const object of ['设计师', '交互设计师', '产品设计师']) {
      const res = await get(origin, '/api/remember', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ layer: 'semantic', subject: '用户', relation: '职业', object, importance: 4 }),
      });
      assert.equal(res.status, 200, JSON.stringify(res.json));
    }

    const listed = await get(origin, '/api/conflicts');
    const group = listed.json.groups.find((g) => g.key === '用户 → 职业');
    assert.ok(group, 'the slot is grouped');
    assert.equal(group.current.object, '产品设计师');
    assert.equal(group.corrected.length, 2);

    const dry = await get(origin, '/api/conflicts/prune', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keep: 1, dryRun: true }),
    });
    assert.equal(dry.json.removed, 1, 'dry run reports without writing');
    const stillTwo = await get(origin, '/api/memories/' + group.corrected[0].id);
    assert.equal(stillTwo.status, 200, 'nothing archived during a dry run');

    const pruned = await get(origin, '/api/conflicts/prune', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: '用户', relation: '职业', keep: 1 }),
    });
    assert.equal(pruned.json.removed, 1);

    const after = await get(origin, '/api/conflicts');
    const group2 = after.json.groups.find((g) => g.key === '用户 → 职业');
    assert.equal(group2.corrected.length, 1, 'one stale version kept for the record');
  });
});

` + anchor;

t = t.replace(anchor, block);
fs.writeFileSync(p, t);
console.log('ok');
