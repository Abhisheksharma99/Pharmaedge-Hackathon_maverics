import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module.js';
import { WebSearchService } from './web-search.service.js';

@Module({ imports: [LlmModule], providers: [WebSearchService], exports: [WebSearchService] })
export class WebSearchModule {}
