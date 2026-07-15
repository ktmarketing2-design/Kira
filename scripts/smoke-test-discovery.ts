import { makeDiscoveryQueue } from '../packages/prospect-discovery/src/queue.js';

const q = makeDiscoveryQueue({ host: '127.0.0.1', port: 6379 });
await q.add('run', { runId: '431e9387-519a-43c7-b96d-2fa5cbec7180' });
await q.close();
console.log('job enqueued');
