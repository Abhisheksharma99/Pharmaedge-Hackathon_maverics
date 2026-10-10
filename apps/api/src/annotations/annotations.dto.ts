import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { RECORD_COLLECTIONS } from '../assets/source-registry.js';

export const NOTE_TAGS = ['Important', 'Missed by AI', 'Question', 'Risk', 'Opportunity'] as const;
export const CATEGORIES = ['regulatory', 'clinical', 'company', 'ip'] as const;

export class CommentDto {
  @IsString() @MinLength(1) @MaxLength(2000) text: string;
}

export class SourceRefDto {
  @IsIn([...RECORD_COLLECTIONS, 'web_records']) collection: string;
  @IsString() @MaxLength(2000) record_key: string;
}

export class NoteDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date: string;
  @IsOptional() @IsString() @MaxLength(40) branch?: string;
  @IsIn(CATEGORIES) category: (typeof CATEGORIES)[number];
  @IsIn(NOTE_TAGS) tag: (typeof NOTE_TAGS)[number];
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsString() @MaxLength(4000) text: string;
  @IsIn(['manual', 'ai']) mode: 'manual' | 'ai';
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => SourceRefDto) sources?: SourceRefDto[];
}

export class NotePatchDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
  @IsOptional() @IsString() @MaxLength(40) branch?: string;
  @IsOptional() @IsIn(CATEGORIES) category?: (typeof CATEGORIES)[number];
  @IsOptional() @IsIn(NOTE_TAGS) tag?: (typeof NOTE_TAGS)[number];
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(4000) text?: string;
}

export class FindNoteDto {
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsOptional() @IsString() @MaxLength(4000) text?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
  @IsOptional() @IsString() @MaxLength(40) branch?: string;
}
