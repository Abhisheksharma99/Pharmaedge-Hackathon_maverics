import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsInt, IsObject, IsOptional, IsString, Length, Matches, Min } from 'class-validator';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../common/decorators/auth.decorators.js';
import { CanvasService, toCanvas } from './canvas.js';

export class CanvasQueryDto {
  @IsOptional()
  @Matches(/^[a-z0-9-]{1,80}$/)
  asset?: string;
}

export class SaveCanvasDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 160)
  title: string;

  /** Checked and rebuilt field by field in CanvasService.save (cleanTree). */
  @IsObject()
  tree: Record<string, unknown>;

  /** The version this edit was based on. */
  @IsInt()
  @Min(1)
  version: number;
}

export class RefreshCanvasDto {
  /** The version the app shows; a newer one on the server is refused (409). */
  @IsInt()
  @Min(1)
  version: number;
}

/** Journey canvases of the signed-in user (created by Asset AI's build_journey_tree, edited here). */
@Controller('canvases')
export class CanvasController {
  constructor(private readonly canvases: CanvasService) {}

  @Get()
  list(@Query() query: CanvasQueryDto, @CurrentUser() user: AuthUser) {
    return this.canvases.list(user, query.asset);
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return toCanvas(await this.canvases.get(user, id));
  }

  @Put(':id')
  async save(@Param('id') id: string, @Body() dto: SaveCanvasDto, @CurrentUser() user: AuthUser) {
    return toCanvas(await this.canvases.save(user, id, dto));
  }

  /** Merge the latest journey events into the canvas, keeping the user's edits; `added` = ids of new nodes. */
  @Post(':id/refresh')
  @HttpCode(200)
  async refresh(@Param('id') id: string, @Body() dto: RefreshCanvasDto, @CurrentUser() user: AuthUser) {
    const { canvas, added, stale, changed } = await this.canvases.refresh(user, id, dto.version);
    return { canvas: toCanvas(canvas), added, stale, changed };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.canvases.remove(user, id);
  }
}
