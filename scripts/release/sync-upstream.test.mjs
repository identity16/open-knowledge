import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syncUpstream } from './sync-upstream.mjs';

const sha = 'a'.repeat(40);
const url = 'https://github.com/identity16/open-knowledge/pull/1';

function scenario(ahead, pulls = [], mutationError = null) {
  const calls = [];
  const result = () =>
    syncUpstream({
      report: () => {},
      api: (method, endpoint, data) => {
        calls.push({ method, endpoint, data });
        if (endpoint.endsWith('/commits/main')) return { sha };
        if (endpoint.includes('/compare/')) return { ahead_by: ahead };
        if (method === 'GET' && endpoint.includes('/pulls?')) return pulls;
        if (mutationError) throw mutationError;
        return { html_url: url };
      },
    });
  return { result, calls };
}

test('an up-to-date main requires no PR queries or writes', () => {
  const { result, calls } = scenario(0);
  assert.equal(result().action, 'unchanged');
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.method === 'GET'));
});

test('new upstream commits open one direct cross-repository PR into main', () => {
  const { result, calls } = scenario(3);
  assert.deepEqual(result(), { action: 'created', url });
  const mutation = calls.at(-1);
  assert.equal(mutation.method, 'POST');
  assert.equal(mutation.endpoint, 'repos/identity16/open-knowledge/pulls');
  assert.equal(mutation.data.head, 'inkeep:main');
  assert.equal(mutation.data.base, 'main');
  assert.match(mutation.data.body, /3 upstream commits were not in main/);
  assert.match(mutation.data.body, /Create a merge commit/);
});

test('an existing open PR is updated instead of duplicated, including conflicting PRs', () => {
  const { result, calls } = scenario(4, [{ number: 7, state: 'open', mergeable: false }]);
  assert.equal(result().action, 'updated');
  assert.equal(calls.at(-1).method, 'PATCH');
  assert.equal(calls.at(-1).endpoint, 'repos/identity16/open-knowledge/pulls/7');
  assert.ok(!calls.some((call) => call.method === 'POST'));
});

test('a dismissed upstream revision is not reopened until upstream moves', () => {
  const rejected = { state: 'closed', merged_at: null, head: { sha }, html_url: url };
  const same = scenario(2, [rejected]);
  assert.equal(same.result().action, 'dismissed');
  assert.ok(same.calls.every((call) => call.method === 'GET'));
  assert.equal(
    scenario(2, [{ ...rejected, head: { sha: 'b'.repeat(40) } }]).result().action,
    'created',
  );
});

test('invalid comparisons and API failures stop without branch writes or merges', () => {
  assert.throws(scenario(undefined).result, /Invalid upstream comparison/);
  const failure = scenario(1, [], new Error('Forbidden'));
  assert.throws(failure.result, /Forbidden/);
  assert.ok(failure.calls.every((call) => !/\/git\/|\/merges|\/merge$/.test(call.endpoint)));
});
