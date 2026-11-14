import { expect, test } from 'vitest';
import { stringify } from 'yaml';
import { OPENKNOWLEDGE16_UPDATE_FEED_URL as appFeed } from '../../packages/desktop/src/shared/desktop-variant.ts';
import { appUpdateConfigProblem, OPENKNOWLEDGE16_UPDATE_FEED } from './build-desktop.mjs';

const good = {
  provider: 'generic',
  url: OPENKNOWLEDGE16_UPDATE_FEED,
  channel: 'latest',
  updaterCacheDirName: 'openknowledge16-updater',
};

test('the release checks the same feed the desktop variant publishes to', () => {
  expect(OPENKNOWLEDGE16_UPDATE_FEED).toBe(appFeed);
});

test('a signed app passes only with an app-update.yml on the OpenKnowledge16 feed', () => {
  expect(appUpdateConfigProblem(stringify(good))).toBeNull();
  expect(appUpdateConfigProblem(null)).toMatch(/could never download an update/);
  expect(
    appUpdateConfigProblem(stringify({ ...good, provider: 'github', url: undefined })),
  ).toMatch(/points at github/);
  expect(appUpdateConfigProblem(stringify({ ...good, channel: 'beta' }))).toMatch(/latest channel/);
});
