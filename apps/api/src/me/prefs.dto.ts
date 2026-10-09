import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';

export class NotifyPrefsDto {
  @IsOptional() @IsBoolean() highEvents?: boolean;
  @IsOptional() @IsBoolean() crawls?: boolean;
  @IsOptional() @IsBoolean() weeklyDigest?: boolean;
}

export class PrefsDto {
  @IsOptional() @IsIn(['h', 'v']) journeyView?: 'h' | 'v';
  @IsOptional() @IsBoolean() sidebarCollapsed?: boolean;
  @IsOptional() @ValidateNested() @Type(() => NotifyPrefsDto) notify?: NotifyPrefsDto;
}

export class MarkReadDto {
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(100) ids?: string[];
}
