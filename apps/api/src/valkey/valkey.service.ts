import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../config/env.js';

/**
 * Shared Valkey connection. Commands fail fast while disconnected (no offline
 * queue), so callers can decide whether to degrade (cache) or refuse (auth).
 */
@Injectable()
export class ValkeyService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ValkeyService.name);
  readonly client: Redis;
  readonly prefix: string;
  private warned = false;

  constructor(config: ConfigService<Env, true>) {
    this.prefix = config.get('VALKEY_PREFIX', { infer: true });
    this.client = new Redis(config.get('VALKEY_URL', { infer: true }), {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
    });
    this.client.on('ready', () => {
      this.warned = false;
      this.logger.log('Valkey connected');
    });
    this.client.on('error', (err) => {
      if (!this.warned) {
        this.logger.warn(`Valkey unavailable: ${err.message}`);
        this.warned = true;
      }
    });
  }

  /** Give the first connection a moment so requests right after boot see it ready. */
  async onModuleInit() {
    if (this.isAvailable()) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2000);
      this.client.once('ready', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  isAvailable(): boolean {
    return this.client.status === 'ready';
  }

  key(...parts: string[]): string {
    return this.prefix + parts.join(':');
  }

  async onApplicationShutdown() {
    this.client.disconnect();
  }
}
