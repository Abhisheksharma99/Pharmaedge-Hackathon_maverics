import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../common/decorators/auth.decorators.js';
import { NotificationsService } from './notifications.service.js';
import { MarkReadDto, PrefsDto } from './prefs.dto.js';

@Controller()
export class MeController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  list(@CurrentUser() user: AuthUser) {
    return this.notifications.list(user.id);
  }

  @Post('notifications/read')
  @HttpCode(200)
  read(@CurrentUser() user: AuthUser, @Body() dto: MarkReadDto) {
    return this.notifications.markRead(user.id, dto.ids);
  }

  @Get('me/prefs')
  prefs(@CurrentUser() user: AuthUser) {
    return this.notifications.prefs(user.id);
  }

  @Patch('me/prefs')
  savePrefs(@CurrentUser() user: AuthUser, @Body() dto: PrefsDto) {
    return this.notifications.savePrefs(user.id, dto);
  }
}
