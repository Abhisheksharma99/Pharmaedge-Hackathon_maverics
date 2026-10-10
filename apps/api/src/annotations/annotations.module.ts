import { Module } from '@nestjs/common';
import { AiThrottlerModule } from '../common/throttle/ai-throttler.js';
import { AssetsModule } from '../assets/assets.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { MeModule } from '../me/me.module.js';
import { WebSearchModule } from '../web-search/web-search.module.js';
import { AnnotationsController } from './annotations.controller.js';
import { AnnotationsService } from './annotations.service.js';
import { NotesFinderService } from './notes-finder.service.js';

@Module({
  imports: [AiThrottlerModule, AssetsModule, LlmModule, MeModule, WebSearchModule],
  controllers: [AnnotationsController],
  providers: [AnnotationsService, NotesFinderService],
  exports: [AnnotationsService],
})
export class AnnotationsModule {}
