import { Controller, Get, Param } from '@nestjs/common';
import { JourneyService } from './journey.service.js';

/** Journey v3 reads (DATA_CONTRACTS §B.1). Event ids are URL-encoded path segments (they contain ':' and '/'). */
@Controller('assets')
export class JourneyController {
  constructor(private readonly journey: JourneyService) {}

  @Get(':id/branches')
  branches(@Param('id') id: string) {
    return this.journey.branches(id);
  }

  @Get(':id/events/:eventId')
  event(@Param('id') id: string, @Param('eventId') eventId: string) {
    return this.journey.event(id, eventId);
  }
}
