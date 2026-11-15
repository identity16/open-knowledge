import { readProcessStart as readServerProcessStart } from '@inkeep/open-knowledge-server';
import { expect, test } from 'vitest';
import { readHolderProcessStart } from './holder-process-start.ts';

test('reads a holder on this host the way the server records it in a lock', () => {
  expect(readHolderProcessStart(process.pid)).toEqual(readServerProcessStart(process.pid));
});
