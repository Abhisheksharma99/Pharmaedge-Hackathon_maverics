import { Module } from '@nestjs/common';
import { MeController } from './me.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({ controllers: [MeController], providers: [NotificationsService], exports: [NotificationsService] })
export class MeModule {}
