import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { CrawlerClient } from '../jobs/crawler.client.js';
import { ResolveDto } from './dto/create-asset.dto.js';

@Controller('resolve')
export class ResolveController {
  constructor(private readonly crawler: CrawlerClient) {}

  /** Identity card for a drug name, from FDA, EMA and ClinicalTrials.gov merged by AI (spec §5.2 step 1). */
  @Post()
  @HttpCode(200)
  resolve(@Body() dto: ResolveDto) {
    return this.crawler.resolve(dto.query);
  }
}
