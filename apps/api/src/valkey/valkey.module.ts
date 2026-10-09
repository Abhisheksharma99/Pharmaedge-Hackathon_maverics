import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service.js';
import { ValkeyService } from './valkey.service.js';

@Global()
@Module({
  providers: [ValkeyService, CacheService],
  exports: [ValkeyService, CacheService],
})
export class ValkeyModule {}
