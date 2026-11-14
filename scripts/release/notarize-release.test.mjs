import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  notaryFailureMessage,
  requireApiCredentials,
  submitNotary,
  waitNotary,
} from './notarize-release.mjs';
import { createCandidate, createSubmission, signedHash } from './release-checkpoint.mjs';
import { releasePlan } from './release-identity.mjs';

const fixtures = [];
afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true });
});
const id = '12ab34cd-1234-4567-89ab-123456789abc';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'release-notary-test-'));
  fixtures.push(root);
  const directory = join(root, 'signed');
  mkdirSync(directory);
  const version = '0.76.0-identity16.5';
  for (const name of [
    'signed-app.zip',
    'builder-config.yml',
    'packaging-resources.tar',
    releasePlan(version).cli,
    'channel.mjs',
  ])
    writeFileSync(join(directory, name), name);
  const candidate = createCandidate(directory, version, {
    sourceSha: 'a'.repeat(40),
    sourceRunId: '101',
  });
  const receipt = createSubmission(candidate, id, '202');
  return { root, directory, candidate, receipt, records: join(root, 'records') };
}
const ok = (body) => ({ exitCode: 0, body });

describe('resumable notarization', () => {
  test('persists a new ID before any waiting', () => {
    const f = fixture();
    const client = vi.fn((args) => (args[0] === 'history' ? ok({ history: [] }) : ok({ id })));
    const result = submitNotary(f.candidate, f.directory, f.records, null, '202', client, f.root);
    expect(result.receipt.submissionId).toBe(id);
    expect(result.uploaded).toBe(true);
    expect(client.mock.calls.map(([args]) => args[0])).toEqual(['history', 'submit']);
    expect(client.mock.calls[1][0][1]).toContain(signedHash(f.candidate));
  });

  test('reuses the saved ID without another submit or history request', () => {
    const f = fixture();
    const client = vi.fn();
    const result = submitNotary(
      f.candidate,
      f.directory,
      f.records,
      f.receipt,
      '303',
      client,
      f.root,
    );
    expect(result.receipt).toBe(f.receipt);
    expect(result.uploaded).toBe(false);
    expect(client).not.toHaveBeenCalled();
  });

  test('recovers an ID after a checkpoint upload failure through its unique archive name', () => {
    const f = fixture();
    const client = vi.fn(() =>
      ok({
        history: [
          {
            id,
            status: 'In Progress',
            name: `OpenKnowledge16-${f.candidate.version}-${signedHash(f.candidate)}.zip`,
          },
        ],
      }),
    );
    expect(
      submitNotary(f.candidate, f.directory, f.records, null, '303', client, f.root).receipt
        .submissionId,
    ).toBe(id);
    expect(client).toHaveBeenCalledTimes(1);
  });

  test('wait retries always use the original submission and never submit again', async () => {
    const f = fixture();
    let checks = 0;
    const client = vi.fn((args) =>
      args[0] === 'info'
        ? ok({ id, status: ++checks === 1 ? 'In Progress' : 'Accepted' })
        : { exitCode: 1, body: null },
    );
    await waitNotary(f.candidate, f.receipt, client, { pause: async () => {} });
    expect(client.mock.calls.map(([args]) => args[0])).toEqual(['info', 'info']);
    expect(client.mock.calls.every(([args]) => args[1] === id)).toBe(true);
  });

  test('times out with a reusable ID rather than rebuilding or resubmitting', async () => {
    const f = fixture();
    let now = 0;
    const client = vi.fn(() => ok({ id, status: 'In Progress' }));
    const pause = vi.fn(async (ms) => {
      now += ms;
    });
    await expect(
      waitNotary(f.candidate, f.receipt, client, { maxWaitMs: 20000, now: () => now, pause }),
    ).rejects.toThrow(id);
    expect(pause.mock.calls).toEqual([[5000], [5000], [5000], [5000]]);
    expect(client.mock.calls.map(([args]) => args[0])).toEqual(['info', 'info', 'info', 'info']);
    expect(client.mock.calls.some(([args]) => args[0] === 'submit')).toBe(false);
  });

  test('rejects a checkpoint for different bytes before contacting Apple', async () => {
    const f = fixture();
    const client = vi.fn();
    await expect(
      waitNotary(f.candidate, { ...f.receipt, signedSha256: 'b'.repeat(64) }, client),
    ).rejects.toThrow(/different signed/);
    expect(client).not.toHaveBeenCalled();
  });

  test('reports rejection without waiting or resubmitting', async () => {
    const f = fixture();
    const client = vi.fn(() => ok({ id, status: 'Invalid' }));
    await expect(waitNotary(f.candidate, f.receipt, client)).rejects.toThrow(/rejected/);
    expect(client).toHaveBeenCalledTimes(1);
  });

  test('requires dedicated API credentials without requiring signing credentials', () => {
    expect(() =>
      requireApiCredentials({
        APPLE_API_KEY: 'key',
        APPLE_API_KEY_ID: 'id',
        APPLE_API_ISSUER: 'issuer',
      }),
    ).not.toThrow();
    expect(() => requireApiCredentials({ APPLE_ID: 'private-value' })).toThrow(/APPLE_API_KEY/);
  });
});

describe('notaryFailureMessage', () => {
  test('carries what notarytool reported so a failed run explains itself', () => {
    expect(
      notaryFailureMessage(
        { exitCode: 69, body: null, detail: 'Error: HTTP status code: 401. Unauthenticated.' },
        'history',
      ),
    ).toBe(
      'Notarization history failed; preserve the checkpoint and retry.\nnotarytool (exit 69): Error: HTTP status code: 401. Unauthenticated.',
    );
  });

  test('falls back to a JSON message and stays short when notarytool said nothing', () => {
    expect(
      notaryFailureMessage({ exitCode: 1, body: { message: 'Agreement missing' } }, 'submission'),
    ).toContain('notarytool (exit 1): Agreement missing');
    expect(notaryFailureMessage({ exitCode: 1, body: null, detail: '' }, 'history')).toBe(
      'Notarization history failed; preserve the checkpoint and retry.',
    );
  });
});
