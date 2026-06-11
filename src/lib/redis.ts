import { Redis } from "@upstash/redis";

let redis: Redis | null | undefined;

/**
 * Upstash Redis client (lazy singleton). Returns null when Redis is not
 * configured — callers must treat Redis as a durability layer, never a
 * hard dependency.
 */
export function getRedis(): Redis | null {
  if (redis !== undefined) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  redis = url && token ? new Redis({ url, token }) : null;
  return redis;
}
