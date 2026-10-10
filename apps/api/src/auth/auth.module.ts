import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { ValkeyThrottlerStorage } from '../common/throttle/valkey-throttler-storage.js';
import { ValkeyService } from '../valkey/valkey.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import type { Env } from '../config/env.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { RefreshTokenStore } from './refresh-token.store.js';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { algorithm: 'HS256', expiresIn: config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true }) },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
    // Only LoginThrottlerGuard uses this; it is not a global guard.
    ThrottlerModule.forRootAsync({
      inject: [ValkeyService],
      useFactory: (valkey: ValkeyService) => ({
        throttlers: [{ name: 'login', ttl: 60_000, limit: 5 }],
        errorMessage: 'Too many sign-in attempts. Please wait a minute and try again.',
        storage: new ValkeyThrottlerStorage(valkey),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    RefreshTokenStore,
    // Order matters: authenticate first, then check roles.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
