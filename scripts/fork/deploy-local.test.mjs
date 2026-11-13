import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localBuildIdentity } from './deploy-local.mjs';

const now = new Date('2026-11-13T10:20:30.456Z');

test('a clean checkout is identified by its commit alone', () => {
  assert.deepEqual(localBuildIdentity({ sha: 'ca37eff', dirty: false, now }), {
    version: '0.0.0-local.ca37eff',
    label: 'local-ca37eff',
  });
});

test('uncommitted changes get a timestamped identity so rebuilds never collide', () => {
  assert.deepEqual(localBuildIdentity({ sha: 'ca37eff', dirty: true, now }), {
    version: '0.0.0-local.ca37eff.dirty.20261113T102030',
    label: 'local-ca37eff.dirty.20261113T102030',
  });
});
