import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgs, shotName } from './preview.mjs';

test('with no arguments it previews the fixture documents on every viewport', () => {
  assert.deepEqual(parseArgs([]), {
    url: null,
    docs: ['README', 'long'],
    viewports: ['mobile', 'desktop'],
  });
});

test('a running app can be previewed by URL with chosen documents and viewports', () => {
  assert.deepEqual(
    parseArgs(['--url', 'http://127.0.0.1:8080/', '--doc', 'notes/today', '--viewport', 'mobile']),
    { url: 'http://127.0.0.1:8080/', docs: ['notes/today'], viewports: ['mobile'] },
  );
});

test('unknown flags and viewports are rejected', () => {
  assert.throws(() => parseArgs(['--port', '1']));
  assert.throws(() => parseArgs(['--viewport', 'tablet']));
});

test('screenshot names are stable and filesystem safe', () => {
  assert.equal(shotName('mobile', null), 'mobile-home.png');
  assert.equal(shotName('desktop', 'notes/today'), 'desktop-notes_today.png');
});
