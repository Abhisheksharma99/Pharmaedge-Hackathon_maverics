import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import type { Db } from 'mongodb';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../common/decorators/auth.decorators.js';
import { MONGO_DB } from '../database/database.module.js';
import { CrawlerClient } from './crawler.client.js';

const STATUSES = ['queued', 'running', 'completed', 'completed_with_errors', 'failed', 'cancelled'];

export class JobsQueryDto {
  @IsOptional()
  @IsString()
  asset?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
}

export class RefreshDto {
  /** Run only these crawl steps (default: all). The crawl service rejects unknown names. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Matches(/^[a-z_]{1,40}$/, { each: true })
  steps?: string[];
}

export class FeedQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  since = 0;
}

const toJob = ({ _id, ...job }: Record<string, unknown>) => ({ id: _id, ...job });

/** Live-build view of a job (DATA_CONTRACTS §A JobProgress). */
const toProgress = (job: Record<string, unknown>) => ({
  ...toJob(job),
  records: Object.entries((job.records_by_coll as Record<string, number> | undefined) ?? {}).map(([coll, count]) => ({ coll, count })),
  events_created: (job.events_created as number | undefined) ?? 0,
  feed_cursor: (job.feed_cursor as number | undefined) ?? 0,
  record_years: (job.record_years as unknown[] | undefined) ?? [],
});

@Controller()
export class JobsController {
  constructor(
    @Inject(MONGO_DB) private readonly db: Db,
    private readonly crawler: CrawlerClient,
  ) {}

  /** Re-run data collection for an asset: every crawler, or the given `steps`. One active job per asset (409 otherwise). */
  @Post('assets/:id/refresh')
  @HttpCode(201)
  async refresh(@Param('id') id: string, @Body() body: RefreshDto, @CurrentUser() user: AuthUser) {
    return toJob(
      await this.crawler.createJob({
        asset_id: id,
        type: 'refresh',
        ...(body.steps && { steps: body.steps }),
        requested_by: { id: user.id, name: user.name },
      }),
    );
  }

  @Get('jobs')
  async list(@Query() query: JobsQueryDto) {
    const match: Record<string, unknown> = {};
    if (query.asset) match.asset = query.asset;
    if (query.status) match.status = query.status;
    const jobs = await this.db.collection('jobs').find(match).sort({ created_at: -1 }).limit(query.limit).toArray();
    const names = new Map(
      (await this.db.collection('assets').find({ _id: { $in: [...new Set(jobs.map((j) => j.asset))] } }, { projection: { name: 1 } }).toArray())
        .map((a) => [a._id, a.name as string]),
    );
    return jobs.map((j) => ({ ...toJob(j), assetName: names.get(j.asset) ?? j.asset }));
  }

  @Get('jobs/:id')
  async get(@Param('id') id: string) {
    const job = await this.db.collection('jobs').findOne({ _id: id as never });
    if (!job) throw new NotFoundException({ code: 'JOB_NOT_FOUND', message: 'Job not found' });
    const asset = await this.db.collection('assets').findOne({ _id: job.asset }, { projection: { name: 1 } });
    return { ...toProgress(job), assetName: (asset?.name as string | undefined) ?? job.asset };
  }

  /** Live-build log lines after `since` (poll every 2 s while the job runs). */
  @Get('jobs/:id/feed')
  async feed(@Param('id') id: string, @Query() query: FeedQueryDto) {
    const job = await this.db.collection('jobs').findOne({ _id: id as never }, { projection: { _id: 1 } });
    if (!job) throw new NotFoundException({ code: 'JOB_NOT_FOUND', message: 'Job not found' });
    const items = await this.db
      .collection('job_feed')
      .find({ job: id, id: { $gt: query.since } }, { projection: { _id: 0, job: 0 } })
      .sort({ id: 1 })
      .limit(500)
      .toArray();
    return { items, cursor: Math.max(query.since, ...items.map((i) => i.id as number)) };
  }

  @Post('jobs/:id/cancel')
  @HttpCode(200)
  async cancel(@Param('id') id: string) {
    return toJob(await this.crawler.cancelJob(id));
  }
}
