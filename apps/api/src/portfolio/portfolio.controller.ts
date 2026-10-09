import { Controller, Get, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PortfolioService } from './portfolio.service.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class PortfolioQueryDto {
  @IsOptional() @Matches(ISO_DATE) from?: string;
  @IsOptional() @Matches(ISO_DATE) to?: string;
  @IsOptional() @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value)) @IsBoolean() competitors?: boolean;
}

export class SearchQueryDto {
  @IsString() @MinLength(1) @MaxLength(120) q: string;
}

@Controller()
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get('portfolio/timeline')
  timeline(@Query() query: PortfolioQueryDto) {
    return this.portfolio.timeline(query);
  }

  @Get('search')
  search(@Query() query: SearchQueryDto) {
    return this.portfolio.search(query.q);
  }
}
