import { Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Env } from '../../config/env.js';
import { ValkeyService } from '../../valkey/valkey.service.js';
import { ValkeyThrottlerStorage } from './valkey-throttler-storage.js';

/** LLM / web-search calls cost money, so they are limited per signed-in user (per route). */
@Injectable()
export class AiThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return String(req.user?.id ?? req.ip);
  }
}

// Only AiThrottlerGuard uses this; it is not a global guard (separate from the login limiter in AuthModule).
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, ValkeyService],
      useFactory: (config: ConfigService<Env, true>, valkey: ValkeyService) => ({
        storage: new ValkeyThrottlerStorage(valkey),
        throttlers: [
          {
            name: 'ai_minute',
            ttl: 60_000,
            limit: config.get('AI_RATE_PER_MINUTE', { infer: true }),
          },
          {
            name: 'ai_hour',
            ttl: 3_600_000,
            limit: config.get('AI_RATE_PER_HOUR', { infer: true }),
          },
        ],
        errorMessage:
          'You are sending AI requests too quickly. Please wait a little and try again.',
      }),
    }),
  ],
  providers: [AiThrottlerGuard],
  exports: [ThrottlerModule, AiThrottlerGuard],
})
export class AiThrottlerModule {}
