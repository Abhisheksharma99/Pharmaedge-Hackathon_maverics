import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import type { FastifyReply } from 'fastify';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../common/decorators/auth.decorators.js';
import { ChatService } from './chat.service.js';
import type { StreamEvent } from './chat.types.js';

const ASSET_ID = /^[a-z0-9-]{1,80}$/;

export class SessionsQueryDto {
  @IsOptional()
  @Matches(ASSET_ID)
  asset?: string;
}

export class CreateSessionDto {
  @IsOptional()
  @Matches(ASSET_ID)
  assetId?: string;
}

export class TurnDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 4000)
  message: string;
}

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('sessions')
  list(@Query() query: SessionsQueryDto, @CurrentUser() user: AuthUser) {
    return this.chat.listSessions(user, query.asset);
  }

  @Post('sessions')
  @HttpCode(201)
  create(@Body() dto: CreateSessionDto, @CurrentUser() user: AuthUser) {
    return this.chat.createSession(user, dto.assetId);
  }

  @Get('sessions/:id/messages')
  messages(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.chat.messages(user, id);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.chat.deleteSession(user, id);
  }

  /** One question; the answer streams back as NDJSON events (spec §6: tool_call, tool_result, card, token, answer, error, done). */
  @Post('sessions/:id/turn')
  async turn(@Param('id') id: string, @Body() dto: TurnDto, @CurrentUser() user: AuthUser, @Res() reply: FastifyReply) {
    // Before the stream starts, errors still get the normal error response.
    const session = await this.chat.prepareTurn(user, id);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
    const abort = new AbortController();
    raw.on('close', () => {
      if (!raw.writableFinished) abort.abort();
    });
    const emit = (e: StreamEvent) => {
      if (!raw.writableEnded && !raw.destroyed) raw.write(`${JSON.stringify(e)}\n`);
    };
    try {
      await this.chat.runTurn(session, dto.message, emit, abort.signal);
    } finally {
      emit({ type: 'done' });
      raw.end();
    }
  }
}
