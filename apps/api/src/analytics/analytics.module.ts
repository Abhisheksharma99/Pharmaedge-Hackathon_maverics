import { Module } from '@nestjs/common';
import { AiThrottlerModule } from '../common/throttle/ai-throttler.js';
import { AssetsModule } from '../assets/assets.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { WebSearchModule } from '../web-search/web-search.module.js';
import { AnalyticsBuildService } from './analytics.build.service.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';

@Module({
  imports: [AiThrottlerModule, AssetsModule, LlmModule, WebSearchModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsBuildService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
