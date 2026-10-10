import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { MeModule } from '../me/me.module.js';
import { JourneyController } from '../journey/journey.controller.js';
import { JourneyService } from '../journey/journey.service.js';
import { AssetLifecycleService } from './asset-lifecycle.service.js';
import { AssetsController } from './assets.controller.js';
import { AssetsService } from './assets.service.js';
import { CompetitorsService } from './competitors.service.js';
import { EvidenceService } from './evidence.service.js';
import { ResolveController } from './resolve.controller.js';
import { SignalsController } from './signals.controller.js';
import { StoryService } from './story.service.js';

@Module({
  imports: [JobsModule, MeModule],
  controllers: [AssetsController, ResolveController, SignalsController, JourneyController],
  providers: [AssetsService, CompetitorsService, EvidenceService, AssetLifecycleService, JourneyService, StoryService],
  exports: [AssetsService, CompetitorsService, JourneyService, StoryService],
})
export class AssetsModule {}
