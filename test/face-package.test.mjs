import test from 'node:test';
import assert from 'node:assert/strict';
import { planFacePackageBindings } from '../dist/index.js';

const characters = [
  { id: 'arthur', name: 'Arthur' },
  { id: 'francis', name: 'Francis' },
  { id: 'yao', name: '王耀' }
];

test('0.32 mixed face package routes common folders to shared template and exact role folders to overrides', () => {
  const plan = planFacePackageBindings([
    'faces/common/eyes/left/open.png',
    'faces/common/mouth/A.png',
    'faces/Arthur/brows/right.png',
    'faces/Francis/mouth/closed.png',
    'faces/王耀/eyes/right/closed.png'
  ], characters);
  assert.equal(plan.shared, 2);
  assert.equal(plan.character, 3);
  assert.equal(plan.unresolved, 0);
  const arthur = plan.items.find(item => item.path.includes('/Arthur/'));
  assert.equal(arthur.targetId, 'arthur');
  assert.equal(arthur.slot, 'browRight');
  const shared = plan.items.find(item => item.path.endsWith('mouth/A.png'));
  assert.equal(shared.targetKind, 'shared');
  assert.equal(shared.slot, 'mouthA');
});

test('0.32 filename role prefixes route safely but fuzzy-looking names remain unresolved', () => {
  const plan = planFacePackageBindings([
    'Arthur_eye_left_open.png',
    'Francis-mouth-th.png',
    'Arth_eye_right_open.png',
    'misc/mouth_A.png'
  ], characters);
  assert.equal(plan.items[0].targetId, 'arthur');
  assert.equal(plan.items[1].targetId, 'francis');
  assert.equal(plan.items[2].targetKind, 'unresolved');
  assert.equal(plan.items[3].targetKind, 'unresolved');
});

test('0.32 per-target conflicts are isolated between shared and character bindings', () => {
  const plan = planFacePackageBindings([
    'common/mouth/A.png',
    'common/mouth/A_v2.png',
    'Arthur/mouth/A.png',
    'Francis/mouth/A.png'
  ], characters);
  const shared = plan.items.filter(item => item.targetKind === 'shared');
  assert.equal(shared.every(item => item.conflict), true);
  assert.equal(plan.items.find(item => item.targetId === 'arthur').conflict, false);
  assert.equal(plan.items.find(item => item.targetId === 'francis').conflict, false);
});

test('0.32 a path that explicitly mixes shared and character directories is never auto-routed', () => {
  const plan = planFacePackageBindings(['common/Arthur/eyes/left/open.png'], characters);
  assert.equal(plan.items[0].targetKind, 'unresolved');
  assert.match(plan.items[0].targetReason, /同时命中/);
});

test('0.33 character package recognizes standing/base art for existing characters and never puts it in shared template', () => {
  const plan = planFacePackageBindings([
    'faces/Arthur/base.png',
    'faces/Francis/standing.webp',
    'faces/common/base.png'
  ], characters);
  const arthur = plan.items[0];
  const francis = plan.items[1];
  const sharedBase = plan.items[2];
  assert.equal(arthur.targetKind, 'character');
  assert.equal(arthur.slot, 'base');
  assert.equal(francis.targetKind, 'character');
  assert.equal(francis.slot, 'base');
  assert.equal(sharedBase.targetKind, 'shared');
  assert.equal(sharedBase.slot, null);
  assert.match(sharedBase.partReason, /不能写入共享模板/);
});

test('0.33 unknown explicit role directories become new-character proposals without fuzzy matching', () => {
  const plan = planFacePackageBindings([
    'faces/Matthew/base.png',
    'faces/Matthew/brows/left.png',
    'faces/misc/mouth/A.png'
  ], characters);
  assert.equal(plan.items[0].targetKind, 'new-character');
  assert.equal(plan.items[0].proposedCharacterName, 'Matthew');
  assert.equal(plan.items[0].slot, 'base');
  assert.equal(plan.items[1].targetKind, 'new-character');
  assert.equal(plan.items[1].slot, 'browLeft');
  assert.equal(plan.items[2].targetKind, 'unresolved');
  assert.equal(plan.newCharacter, 2);
});

test('0.33 face subfolder defaults do not get misclassified as character base art', () => {
  const plan = planFacePackageBindings(['faces/Matthew/eyes/default.png'], characters);
  assert.equal(plan.items[0].targetKind, 'new-character');
  assert.notEqual(plan.items[0].slot, 'base');
  assert.equal(plan.items[0].slot, 'eyesOpen');
  assert.ok(plan.items[0].confidence < 0.9, 'default eye art should be a low-confidence guess requiring confirmation');
});
