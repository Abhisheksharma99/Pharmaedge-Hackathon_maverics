import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../common/decorators/auth.decorators.js';
import { CommentDto, NoteDto, NotePatchDto } from './annotations.dto.js';
import { AnnotationsService } from './annotations.service.js';

@Controller('assets/:id')
export class AnnotationsController {
  constructor(private readonly annotations: AnnotationsService) {}

  @Get('annotations')
  list(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.annotations.annotations(id, user);
  }

  @Put('events/:eventId/star')
  @HttpCode(204)
  async star(@Param('id') id: string, @Param('eventId') eventId: string, @CurrentUser() user: AuthUser) {
    await this.annotations.star(id, eventId, user, true);
  }

  @Delete('events/:eventId/star')
  @HttpCode(204)
  async unstar(@Param('id') id: string, @Param('eventId') eventId: string, @CurrentUser() user: AuthUser) {
    await this.annotations.star(id, eventId, user, false);
  }

  @Post('events/:eventId/comments')
  @HttpCode(201)
  comment(@Param('id') id: string, @Param('eventId') eventId: string, @CurrentUser() user: AuthUser, @Body() dto: CommentDto) {
    return this.annotations.addComment(id, eventId, user, dto);
  }

  @Delete('comments/:commentId')
  @HttpCode(204)
  async deleteComment(@Param('id') id: string, @Param('commentId') commentId: string, @CurrentUser() user: AuthUser) {
    await this.annotations.deleteComment(id, commentId, user);
  }

  @Post('notes')
  @HttpCode(201)
  addNote(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: NoteDto) {
    return this.annotations.addNote(id, user, dto);
  }

  @Patch('notes/:noteId')
  updateNote(@Param('id') id: string, @Param('noteId') noteId: string, @CurrentUser() user: AuthUser, @Body() dto: NotePatchDto) {
    return this.annotations.updateNote(id, noteId, user, dto);
  }

  @Delete('notes/:noteId')
  @HttpCode(204)
  async deleteNote(@Param('id') id: string, @Param('noteId') noteId: string, @CurrentUser() user: AuthUser) {
    await this.annotations.deleteNote(id, noteId, user);
  }
}
