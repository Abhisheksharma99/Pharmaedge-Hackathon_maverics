import { Controller, Get, Inject } from '@nestjs/common';
import type { Db } from 'mongodb';
import { Public } from '../common/decorators/auth.decorators.js';
import { MONGO_DB } from '../database/database.module.js';
import { ValkeyService } from '../valkey/valkey.service.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(MONGO_DB) private readonly db: Db,
    private readonly valkey: ValkeyService,
  ) {}

  @Public()
  @Get()
  async check() {
    let mongo = 'up';
    try {
      await this.db.command({ ping: 1 });
    } catch {
      mongo = 'down';
    }
    return { status: 'ok', mongo, valkey: this.valkey.isAvailable() ? 'up' : 'down' };
  }
}
