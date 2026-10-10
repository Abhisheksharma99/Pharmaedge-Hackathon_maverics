import { Logger } from '@nestjs/common';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;
import type { ValkeyService } from '../../valkey/valkey.service.js';

/**
 * Throttler counters in Valkey so the limits hold across API processes: one key per tracker + route + limiter,
 * INCR on every hit, PEXPIRE on the first (a fixed window of `ttl`); over the limit means blocked until the window
 * ends (no route here sets a separate block duration). While Valkey is down it falls back to per-process memory.
 */
export class ValkeyThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(ValkeyThrottlerStorage.name);
  private readonly memory = new ThrottlerStorageService();
  private warned = false;

  constructor(private readonly valkey: Pick<ValkeyService, 'client' | 'isAvailable' | 'key'>) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    if (this.valkey.isAvailable()) {
      try {
        const record = await this.incrementInValkey(key, ttl, limit, throttlerName);
        this.warned = false;
        return record;
      } catch (err) {
        if (!this.warned) this.logger.warn(`Valkey throttle failed, using in-memory counters: ${(err as Error).message}`);
        this.warned = true;
      }
    }
    return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
  }

  private async incrementInValkey(key: string, ttl: number, limit: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const { client } = this.valkey;
    const hits = this.valkey.key('throttle', throttlerName, key);
    const totalHits = await client.incr(hits);
    let pttl = await client.pttl(hits);
    if (totalHits === 1 || pttl < 0) {
      await client.pexpire(hits, ttl);
      pttl = ttl;
    }
    const timeToExpire = Math.ceil(pttl / 1000);
    const isBlocked = totalHits > limit;
    return { totalHits, timeToExpire, isBlocked, timeToBlockExpire: isBlocked ? timeToExpire : 0 };
  }

  onApplicationShutdown() {
    this.memory.onApplicationShutdown();
  }
}
