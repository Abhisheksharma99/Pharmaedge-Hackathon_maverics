import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Roles } from '../common/decorators/auth.decorators.js';
import { AssetLifecycleService } from './asset-lifecycle.service.js';
import { AssetsService } from './assets.service.js';
import { CompetitorsService } from './competitors.service.js';
import { ChangesQueryDto, LedgerQueryDto, MarketQueryDto, RecordQueryDto, StoryQueryDto, RecordsQueryDto, TimelineQueryDto } from './dto/asset-queries.dto.js';
import { CreateAssetDto } from './dto/create-asset.dto.js';
import { EvidenceService } from './evidence.service.js';
import { StoryService } from './story.service.js';

@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly competitorsView: CompetitorsService,
    private readonly evidenceView: EvidenceService,
    private readonly lifecycle: AssetLifecycleService,
    private readonly stories: StoryService,
  ) {}

  @Get()
  list() {
    return this.assets.list();
  }

  /** Create an asset from a confirmed identity card and start its onboarding crawl (spec §5.2). */
  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateAssetDto, @CurrentUser() user: AuthUser) {
    return this.lifecycle.create(dto, user);
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.lifecycle.remove(id);
  }

  @Get(':id/competitors')
  competitors(@Param('id') id: string) {
    return this.competitorsView.competitors(id);
  }

  @Get(':id/evidence')
  evidence(@Param('id') id: string) {
    return this.evidenceView.evidence(id);
  }

  @Get(':id/ledger')
  ledger(@Param('id') id: string, @Query() query: LedgerQueryDto) {
    return this.evidenceView.ledger(id, query);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.assets.detail(id);
  }

  @Get(':id/timeline')
  timeline(@Param('id') id: string, @Query() query: TimelineQueryDto) {
    return this.assets.timeline(id, query);
  }

  /** Company share price with the move after each journey event (timing, never causation). */
  @Get(':id/market')
  market(@Param('id') id: string, @Query() query: MarketQueryDto) {
    return this.assets.market(id, query);
  }

  /** The journey story: lanes, approvals, chapters, what changed (since), checks, comparison (spec 2026-10-10). */
  @Get(':id/story')
  story(@Param('id') id: string, @Query() query: StoryQueryDto) {
    return this.stories.story(id, query);
  }

  /** What changed in the asset's evidence since a date: developments, updates, checks, label and trial changes. */
  @Get(':id/changes')
  async changes(@Param('id') id: string, @Query() query: ChangesQueryDto) {
    return (await this.stories.story(id, { since: query.since })).changes;
  }

  @Get(':id/series/adverse-events')
  adverseEvents(@Param('id') id: string) {
    return this.assets.adverseEvents(id);
  }

  @Get(':id/records/:tab')
  records(@Param('id') id: string, @Param('tab') tab: string, @Query() query: RecordsQueryDto) {
    return this.assets.records(id, tab, query);
  }

  /** One full record (with text). The key goes in the query: record keys contain URLs. */
  @Get(':id/record/:tab')
  record(@Param('id') id: string, @Param('tab') tab: string, @Query() query: RecordQueryDto) {
    return this.assets.record(id, tab, query.key);
  }
}
