import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

let redisClient;
let redisSubscriber;

const connectRedis = async () => {
  try {
    redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    redisSubscriber = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    await redisClient.ping();
    console.log('✅ Redis connected successfully');
    
    return { redisClient, redisSubscriber };
  } catch (error) {
    console.error('❌ Redis connection error:', error);
    process.exit(1);
  }
};

const getRedisClient = () => redisClient;
const getRedisSubscriber = () => redisSubscriber;

export { connectRedis, getRedisClient, getRedisSubscriber };