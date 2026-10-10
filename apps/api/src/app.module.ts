import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { AnnotationsModule } from './annotations/annotations.module.js';
import { AssetsModule } from './assets/assets.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ChatModule } from './chat/chat.module.js';
import { validateEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { JobsModule } from './jobs/jobs.module.js';
import { MeModule } from './me/me.module.js';
import { PortfolioModule } from './portfolio/portfolio.module.js';
import { UsersModule } from './users/users.module.js';
import { ValkeyModule } from './valkey/valkey.module.js';
import { WebSearchModule } from './web-search/web-search.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, envFilePath: ['.env'], validate: validateEnv }),
    DatabaseModule,
    ValkeyModule,
    UsersModule,
    AuthModule,
    AssetsModule,
    JobsModule,
    ChatModule,
    MeModule,
    AnnotationsModule,
    PortfolioModule,
    AnalyticsModule,
    WebSearchModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
