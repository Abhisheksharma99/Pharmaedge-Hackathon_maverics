import { Module } from '@nestjs/common';
import { CrawlerClient } from './crawler.client.js';
import { JobsController } from './jobs.controller.js';

@Module({
  controllers: [JobsController],
  providers: [CrawlerClient],
  exports: [CrawlerClient],
})
export class JobsModule {}
