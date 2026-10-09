import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module.js';
import { AnnotationsController } from './annotations.controller.js';
import { AnnotationsService } from './annotations.service.js';

@Module({ imports: [AssetsModule], controllers: [AnnotationsController], providers: [AnnotationsService], exports: [AnnotationsService] })
export class AnnotationsModule {}
