import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entryScripts, localBuildIdentity, servedBuildProblem } from './deploy-local.mjs';

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

const html = (src) => `<script type="module" crossorigin src="${src}"></script>`;

test('entry scripts are the module script sources of the page', () => {
  assert.deepEqual(entryScripts(`${html('./assets/index-B.js')}<script src="x.js"></script>`), [
    './assets/index-B.js',
  ]);
});

test('a deploy counts only when the service runs the new label and serves its bundle', () => {
  const installedHtml = html('./assets/index-new.js');
  assert.equal(
    servedBuildProblem({
      label: 'local-abc',
      stateTag: 'local-abc',
      installedHtml,
      servedHtml: installedHtml,
    }),
    null,
  );
  assert.match(
    servedBuildProblem({
      label: 'local-abc',
      stateTag: 'v0.77.0',
      installedHtml,
      servedHtml: html('./assets/index-old.js'),
    }),
    /started v0\.77\.0 instead of local-abc/,
  );
  assert.match(
    servedBuildProblem({
      label: 'local-abc',
      stateTag: 'local-abc',
      installedHtml,
      servedHtml: html('./assets/index-old.js'),
    }),
    /serves \.\/assets\/index-old\.js, not local-abc/,
  );
});
