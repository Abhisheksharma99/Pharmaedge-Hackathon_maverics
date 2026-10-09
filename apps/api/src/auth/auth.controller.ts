import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser, Public } from '../common/decorators/auth.decorators.js';
import type { Env } from '../config/env.js';
import { AuthService, type Session } from './auth.service.js';
import { ACCESS_COOKIE, REFRESH_COOKIE, type AuthUser } from './auth.types.js';
import { LoginDto } from './dto/login.dto.js';
import { LoginThrottlerGuard } from './login-throttler.guard.js';

/** The access cookie is sent to every API call; the refresh cookie only to /api/auth. */
const ACCESS_PATH = '/api';
const REFRESH_PATH = '/api/auth';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @UseGuards(LoginThrottlerGuard)
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.respond(reply, await this.auth.login(dto.email, dto.password));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      return this.respond(reply, await this.auth.refresh(req.cookies[REFRESH_COOKIE]));
    } catch (err) {
      this.clearCookies(reply);
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.logout(req.cookies[REFRESH_COOKIE]);
    this.clearCookies(reply);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return { user: await this.auth.me(user.id) };
  }

  private respond(reply: FastifyReply, session: Session) {
    const base = { httpOnly: true, sameSite: 'strict' as const, secure: this.config.get('COOKIE_SECURE', { infer: true }) };
    reply.setCookie(ACCESS_COOKIE, session.accessToken, {
      ...base,
      path: ACCESS_PATH,
      maxAge: this.config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true }),
    });
    reply.setCookie(REFRESH_COOKIE, session.refreshToken, {
      ...base,
      path: REFRESH_PATH,
      maxAge: this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 24 * 3600,
    });
    return { user: session.user };
  }

  private clearCookies(reply: FastifyReply) {
    reply.clearCookie(ACCESS_COOKIE, { path: ACCESS_PATH });
    reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
  }
}
