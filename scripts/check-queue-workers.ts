import { Queue } from 'bullmq';
import { QUEUES } from '@tp/queue';

const connection = {
  host: '127.0.0.1',
  port: 6379,
};

async function check() {
  for (const [key, name] of Object.entries(QUEUES)) {
    const queue = new Queue(name, { connection });
    const workers = await queue.getWorkers();
    console.log(`Active workers on ${name}:`, workers.map(w => w.id));
    await queue.close();
  }
}

check().catch(console.error);
