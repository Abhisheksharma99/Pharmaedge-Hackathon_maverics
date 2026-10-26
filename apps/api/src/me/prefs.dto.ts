import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsISO8601, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class NotifyPrefsDto {
  @IsOptional() @IsBoolean() highEvents?: boolean;
  @IsOptional() @IsBoolean() crawls?: boolean;
  @IsOptional() @IsBoolean() weeklyDigest?: boolean;
}

/** "I just opened this page"; the server keeps the time and the previous visit's (see NotificationsService.savePrefs). */
export class LastSeenDto {
  @IsOptional() @IsISO8601() home?: string;
}

export class PrefsDto {
  @IsOptional() @IsIn(['h', 'v']) journeyView?: 'h' | 'v';
  @IsOptional() @IsBoolean() sidebarCollapsed?: boolean;
  @IsOptional() @ValidateNested() @Type(() => NotifyPrefsDto) notify?: NotifyPrefsDto;
  @IsOptional() @ValidateNested() @Type(() => LastSeenDto) lastSeen?: LastSeenDto;
  /** Starred asset ids; replaces the stored list. */
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) @MaxLength(200, { each: true }) watchlist?: string[];
  /** Home's Watchlist chip: limit every Home card to watched assets. */
  @IsOptional() @IsBoolean() homeWatchlistOnly?: boolean;
}

export class MarkReadDto {
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(100) ids?: string[];
}
