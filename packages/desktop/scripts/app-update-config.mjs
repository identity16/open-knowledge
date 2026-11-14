import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';

export const APP_UPDATE_CONFIG_FILE = 'app-update.yml';

export function appUpdateConfig(publish, updaterCacheDirName) {
  const [first] = Array.isArray(publish) ? publish : publish ? [publish] : [];
  if (!first || typeof first !== 'object' || !first.provider)
    throw new Error('[afterPack] no publish provider to write app-update.yml from.');
  return { ...first, updaterCacheDirName };
}

export function ensureAppUpdateConfig(resourcesDir, packager) {
  const path = join(resourcesDir, APP_UPDATE_CONFIG_FILE);
  if (existsSync(path)) return { path, written: false };
  const config = appUpdateConfig(packager.config.publish, packager.appInfo.updaterCacheDirName);
  writeFileSync(path, stringify(config));
  return { path, written: true };
}
