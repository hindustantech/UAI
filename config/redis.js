// config/redis.js

import Redis from "ioredis";

const redis = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,

  maxRetriesPerRequest: null,
  enableReadyCheck: true,

  retryStrategy(times) {
    return Math.min(times * 100, 3000);
  },

  reconnectOnError() {
    return true;
  },
});

redis.on("connect", () => {
  console.log("✅ Redis Connected");
});

redis.on("ready", () => {
  console.log("🚀 Redis Ready");
});

redis.on("error", (err) => {
  console.error("❌ Redis Error:", err.message);
});

redis.on("close", () => {
  console.log("⚠️ Redis Connection Closed");
});

redis.on("reconnecting", () => {
  console.log("♻️ Redis Reconnecting...");
});

export default redis;