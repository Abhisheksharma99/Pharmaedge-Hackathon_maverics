import { Injectable } from '@nestjs/common';
import { ValkeyService } from './valkey.service.js';

/**
 * JSON cache on Valkey that never breaks a request: when Valkey is down, reads
 * miss and writes are dropped.
 */
@Injectable()
export class CacheService {
  constructor(private readonly valkey: ValkeyService) {}

  async getJson<T>(key: string): Promise<T | null> {
    if (!this.valkey.isAvailable()) return null;
    try {
      const raw = await this.valkey.client.get(this.valkey.key(key));
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.valkey.isAvailable()) return;
    try {
      await this.valkey.client.set(this.valkey.key(key), JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      // cache write failures are not request failures
    }
  }

  /** Invalidate everything cached under a version counter (no-op when Valkey is down). */
  async bump(key: string): Promise<void> {
    if (!this.valkey.isAvailable()) return;
    try {
      await this.valkey.client.incr(this.valkey.key(key));
    } catch {
      // stale cache entries expire with their TTL
    }
  }

  /** Current value of a version counter (0 when unset or Valkey is down). */
  async version(key: string): Promise<number> {
    if (!this.valkey.isAvailable()) return 0;
    try {
      return Number((await this.valkey.client.get(this.valkey.key(key))) ?? 0);
    } catch {
      return 0;
    }
  }
}
