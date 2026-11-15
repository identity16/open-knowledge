import { defineConfig, type ViteUserConfig } from 'vitest/config';
import { appVitestConfig } from './vitest.config';

export const appUnitVitestConfig = {
  ...appVitestConfig,
  test: {
    ...appVitestConfig.test,
    include: [
      'src/**/*.test.ts?(x)',
      'scripts/check-react-compiler.test.ts',
      'tests/free-port.test.ts',
      'tests/temp-dir.test.ts',
      'tests/perf/fixtures/**/*.test.ts?(x)',
      'tests/perf/lib/**/*.test.ts?(x)',
      'tests/perf/probes/**/*.test.ts?(x)',
      'tests/perf/profile.test.ts',
      'tests/perf/scenarios/sweep-cache-regime.smoke.test.ts',
      'tests/perf/scenarios/sweep-convention-cap-graduation.smoke.test.ts',
      'tests/stress/oracle-e-expectations.test.ts',
      'tests/stress/_helpers/e2e-coverage/**/*.test.ts?(x)',
    ],
  },
} satisfies ViteUserConfig;

export default defineConfig(appUnitVitestConfig);
