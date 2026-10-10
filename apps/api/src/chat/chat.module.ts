import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { AccessPolicy } from './access-policy.js';
import { CanvasController } from './canvas.controller.js';
import { CanvasService } from './canvas.js';
import { ChatTools } from './chat-tools.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { EvidenceSearch } from './evidence-search.js';
import { StoriesController } from './stories.controller.js';
import { StoryStore } from './stories.js';

@Module({
  imports: [AssetsModule, JobsModule, LlmModule],
  controllers: [ChatController, CanvasController, StoriesController],
  providers: [ChatService, ChatTools, EvidenceSearch, AccessPolicy, CanvasService, StoryStore],
})
export class ChatModule {}
