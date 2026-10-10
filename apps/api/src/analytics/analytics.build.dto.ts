import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SUGGESTION_IDS, type SuggestionId } from './analytics.build.js';

/** Exactly one of `request` / `suggestion` (checked in the service; both and neither are 400). */
export class BuildAnalyticsDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(500) request?: string;
  @IsOptional() @IsIn(SUGGESTION_IDS) suggestion?: SuggestionId;
}
