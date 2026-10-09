import { Module } from '@nestjs/common';
import { PortfolioController } from './portfolio.controller.js';
import { PortfolioService } from './portfolio.service.js';

@Module({ controllers: [PortfolioController], providers: [PortfolioService] })
export class PortfolioModule {}
