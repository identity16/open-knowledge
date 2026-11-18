import { createWorker } from './worker.ts';

export default createWorker((input, init) => fetch(input, init));
