interface HarnessScenarioHost {
  snapshot(): void;
  captureFailure?(): Promise<void>;
  cancelCapture?(): void;
  release(): void;
}

interface HarnessScenarioRunnerOptions {
  titles: readonly string[];
  grantMs(before: string): number;
  isRefusal(error: unknown): boolean;
  print(line: string): void;
}

type ScenarioOutcome = 'passed' | 'failed' | 'refused';

export function createHarnessScenarioRunner(options: HarnessScenarioRunnerOptions) {
  const results: Array<{ name: string; outcome: ScenarioOutcome; detail?: string }> = [];
  const unrun = new Set(options.titles);
  const owned: HarnessScenarioHost[] = [];
  let inFlight: string | null = null;

  const tally = (outcome: ScenarioOutcome): number =>
    results.filter((result) => result.outcome === outcome).length;

  const producedNoResult = (): number => unrun.size + (inFlight === null ? 0 : 1);

  const verdictLine = (detail: string): string =>
    `HARNESS_RESULT ok=${tally('passed')} fail=${tally('failed') + producedNoResult()} refused=${tally('refused')}${detail}`;

  return {
    own(host: HarnessScenarioHost): void {
      owned.push(host);
    },
    async run(name: string, fn: (deadlineAt: number) => Promise<void>): Promise<void> {
      if (!unrun.delete(name)) {
        results.push({
          name,
          outcome: 'failed',
          detail: 'not a title the harness roster declares',
        });
        options.print(`FAIL ${name} :: not a title the harness roster declares`);
        return;
      }
      inFlight = name;
      try {
        const deadlineAt = performance.now() + options.grantMs('this scenario started');
        await fn(deadlineAt);
        results.push({ name, outcome: 'passed' });
        options.print(`PASS ${name}`);
      } catch (err) {
        const outcome = options.isRefusal(err) ? 'refused' : 'failed';
        if (outcome === 'failed') {
          for (const host of owned) await host.captureFailure?.();
        }
        for (const host of owned) host.snapshot();
        results.push({ name, outcome, detail: (err as Error).message });
        options.print(
          `${outcome === 'refused' ? 'REFUSED' : 'FAIL'} ${name} :: ${(err as Error).message}`,
        );
      } finally {
        inFlight = null;
        for (const host of owned.splice(0)) host.release();
      }
    },
    verdictLine,
    hardTimeoutVerdict(): string {
      for (const host of owned) host.cancelCapture?.();
      for (const host of owned) host.snapshot();
      return verdictLine(` :: hard timeout during ${inFlight ?? 'startup'}`);
    },
    unrunTitles: (): string[] => [...unrun],
    passed: (): boolean => tally('failed') === 0 && tally('refused') === 0,
  };
}
