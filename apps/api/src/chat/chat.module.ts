import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { ChatTools } from './chat-tools.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';

@Module({
  imports: [AssetsModule, JobsModule, LlmModule],
  controllers: [ChatController],
  providers: [ChatService, ChatTools],
})
export class ChatModule {}
