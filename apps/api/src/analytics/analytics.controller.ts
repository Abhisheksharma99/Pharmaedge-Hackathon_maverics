import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../common/decorators/auth.decorators.js';
import { AiThrottlerGuard } from '../common/throttle/ai-throttler.js';
import { BuildAnalyticsDto } from './analytics.build.dto.js';
import { AnalyticsBuildService } from './analytics.build.service.js';
import { AnalyticsService } from './analytics.service.js';

@Controller('assets/:id')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly build: AnalyticsBuildService,
  ) {}

  @Get('analytics')
  blocks(@Param('id') id: string) {
    return this.analytics.blocks(id);
  }

  @Get('analytics/suggestions')
  suggestions(@Param('id') id: string) {
    return this.analytics.suggestions(id);
  }

  @UseGuards(AiThrottlerGuard)
  @Post('analytics/build')
  startBuild(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: BuildAnalyticsDto) {
    return this.build.start(id, user.id, dto);
  }

  @Get('analytics/build/:runId')
  buildRun(@Param('id') id: string, @Param('runId') runId: string, @CurrentUser() user: AuthUser) {
    return this.build.run(id, runId, user.id);
  }

  @Get('records/:tab/insights')
  insights(@Param('id') id: string, @Param('tab') tab: string) {
    return this.analytics.insights(id, tab);
  }

  @Get('analytics/pins')
  pins(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.analytics.pins(id, user.id);
  }

  @Put('analytics/pins')
  savePins(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: { items?: unknown }) {
    return this.analytics.savePins(id, user.id, body?.items);
  }
}
