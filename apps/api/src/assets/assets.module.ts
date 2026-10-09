import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { AssetLifecycleService } from './asset-lifecycle.service.js';
import { AssetsController } from './assets.controller.js';
import { AssetsService } from './assets.service.js';
import { CompetitorsService } from './competitors.service.js';
import { EvidenceService } from './evidence.service.js';
import { ResolveController } from './resolve.controller.js';
import { SignalsController } from './signals.controller.js';

@Module({
  imports: [JobsModule],
  controllers: [AssetsController, ResolveController, SignalsController],
  providers: [AssetsService, CompetitorsService, EvidenceService, AssetLifecycleService],
  exports: [AssetsService, CompetitorsService],
})
export class AssetsModule {}
