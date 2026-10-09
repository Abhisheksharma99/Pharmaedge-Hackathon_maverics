import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../common/decorators/auth.decorators.js';
import { AnalyticsService } from './analytics.service.js';

@Controller('assets/:id')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('analytics')
  blocks(@Param('id') id: string) {
    return this.analytics.blocks(id);
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
