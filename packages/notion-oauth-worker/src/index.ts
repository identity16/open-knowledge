import { durableGrantStore, GrantVault, type VaultNamespace } from './grant-vault.ts';
import { createWorker, type WorkerEnv } from './worker.ts';

const worker = createWorker((input, init) => fetch(input, init));

export { GrantVault };

export default {
  fetch(request: Request, env: Omit<WorkerEnv, 'GRANTS'> & { readonly GRANTS: VaultNamespace }) {
    return worker.fetch(request, { ...env, GRANTS: durableGrantStore(env.GRANTS) });
  },
};
