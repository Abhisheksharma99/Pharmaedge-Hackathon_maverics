import { Module } from '@nestjs/common';
import { LlmService } from './llm.service.js';

@Module({
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
