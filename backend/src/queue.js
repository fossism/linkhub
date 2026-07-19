import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// BullMQ requires maxRetriesPerRequest to be null for queue connections
export const connection = new IORedis(redisUrl, { 
  maxRetriesPerRequest: null 
});

export const ingestionQueue = new Queue('ingestionQueue', { 
  connection 
});

export default {
  ingestionQueue,
  connection
};
