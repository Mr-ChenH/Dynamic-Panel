const test = require('node:test');
const assert = require('node:assert/strict');
const { taskWindowMatchScore } = require('../main/task-window-matcher');

test('task window matcher ranks exact and prefixed project titles', () => {
  assert.equal(taskWindowMatchScore({ project: 'Dynamic Panel' }, { title: 'Dynamic Panel' }), 100);
  assert.equal(taskWindowMatchScore({ project: 'Dynamic Panel' }, { title: 'Dynamic Panel - Work' }), 90);
  assert.equal(taskWindowMatchScore({ project: 'Dynamic Panel' }, { title: 'Notes for Dynamic Panel' }), 75);
});

test('task window matcher uses app name as a weak fallback and rejects empty inputs', () => {
  assert.equal(taskWindowMatchScore({ project: 'Visual Studio Code' }, { title: 'Untitled', appName: 'Visual Studio Code' }), 25);
  assert.equal(taskWindowMatchScore({ project: '' }, { title: 'Dynamic Panel' }), 0);
  assert.equal(taskWindowMatchScore({ project: 'Dynamic Panel' }, { title: '' }), 0);
  assert.equal(taskWindowMatchScore({ project: 'Other' }, { title: 'Dynamic Panel', appName: 'Code' }), 0);
});
