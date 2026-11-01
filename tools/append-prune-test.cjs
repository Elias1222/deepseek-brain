
test('pruneConflicts archives stale versions but keeps the newest one per slot', async () => {
  const memory = await makeMemory({ demoSeed: false }).init();
  memory.remember({ layer: 'semantic', subject: '用户', relation: '职业', object: '设计师', importance: 4 });
  memory.remember({ layer: 'semantic', subject: '用户', relation: '职业', object: '交互设计师', importance: 4 });
  const live = memory.remember({ layer: 'semantic', subject: '用户', relation: '职业', object: '产品设计师', importance: 5 }).item;

  const groups = memory.conflictGroups();
  assert.equal(groups.length, 1, 'one slot piles up two stale values');
  assert.equal(groups[0].key, '用户 → 职业');
  assert.equal(groups[0].current.id, live.id);
  assert.equal(groups[0].corrected.length, 2);
  assert.equal(groups[0].removable, 1, 'keep=1 leaves one removable');

  const preview = memory.pruneConflicts({ dryRun: true });
  assert.equal(preview.removed, 1);
  assert.equal(memory.semantic.items.length, 3, 'dry run changes nothing');

  const report = memory.pruneConflicts({ keep: 1 });
  assert.equal(report.removed, 1);
  assert.equal(memory.semantic.items.length, 2, 'one stale copy archived, the active one untouched');
  assert.equal(memory.conflictGroups()[0].corrected.length, 1, 'the newest stale version survives');
  assert.ok(memory.archive.some((it) => it.reason === 'superseded'), 'archived entries say why');
  assert.ok(memory.activity.recent(2).some((e) => e.kind === 'prune'));

  const again = memory.pruneConflicts({ keep: 1 });
  assert.equal(again.removed, 0, 'second pass is a no-op');
});
