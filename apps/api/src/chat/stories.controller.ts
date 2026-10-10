import { Controller, Delete, Get, HttpCode, Param, Query } from '@nestjs/common';
import { IsOptional, Matches } from 'class-validator';
import { StoryQueryDto } from '../assets/dto/asset-queries.dto.js';
import { StoryService } from '../assets/story.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../common/decorators/auth.decorators.js';
import { AccessPolicy } from './access-policy.js';
import { StoryStore, toStory } from './stories.js';

export class StoriesQueryDto {
  @IsOptional()
  @Matches(/^[a-z0-9-]{1,80}$/)
  asset?: string;
}

/** Journey stories of the signed-in user (built by Asset AI's build_journey_story, opened in the canvas area). */
@Controller('stories')
export class StoriesController {
  constructor(
    private readonly stories: StoryStore,
    private readonly compose: StoryService,
    private readonly policy: AccessPolicy,
  ) {}

  @Get()
  list(@Query() query: StoriesQueryDto, @CurrentUser() user: AuthUser) {
    return this.stories.list(user, query.asset);
  }

  /** The saved story with its timeline recomputed from the latest data; query filters override the saved spec. */
  @Get(':id')
  async get(@Param('id') id: string, @Query() filters: StoryQueryDto, @CurrentUser() user: AuthUser) {
    const doc = await this.stories.get(user.id, id);
    const spec = { ...doc.spec, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined)) };
    // compare=none turns the comparison off; an asset the user may not read shows the story without it.
    if (spec.compare === 'none' || (spec.compare && !(await this.policy.allowedAssets(user.id)).has(spec.compare))) delete spec.compare;
    return { ...toStory(doc), story: await this.compose.story(doc.asset_id, spec) };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.stories.remove(user, id);
  }
}
