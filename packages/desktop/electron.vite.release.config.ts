import { defineConfig } from 'electron-vite';
import config from './electron.vite.config';

if (!config.main || !config.preload) {
  throw new Error('The packaged desktop build requires main and preload configurations.');
}

export default defineConfig({ main: config.main, preload: config.preload });
