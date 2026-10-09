import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimmedList = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? [...new Set(value.map((v) => (typeof v === 'string' ? v.trim() : v)).filter(Boolean))] : value;
const URL_OPTS = { require_protocol: true, protocols: ['http', 'https'] };

export class CompanyDto {
  @Transform(trimmed)
  @IsString()
  @Length(1, 120)
  name: string;

  /** Empty string = unknown. */
  @IsOptional()
  @Transform(trimmed)
  @ValidateIf((_, v) => v !== '')
  @IsUrl(URL_OPTS)
  website?: string;

  @IsOptional()
  @Transform(trimmed)
  @ValidateIf((_, v) => v !== '')
  @IsUrl(URL_OPTS)
  ir_url?: string;
}

export class TagsDto {
  @Transform(trimmedList)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  indications: string[];

  @IsOptional()
  @Transform(trimmedList)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  investigational_indications?: string[];

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(160)
  mechanism?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(60)
  modality?: string;
}

/** The (possibly edited) identity card the user confirmed in Asset AI. */
export class CreateAssetDto {
  @Transform(trimmed)
  @IsString()
  @Length(2, 80)
  name: string;

  @Transform(trimmedList)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  aliases: string[];

  @ValidateNested()
  @Type(() => CompanyDto)
  company: CompanyDto;

  @ValidateNested()
  @Type(() => TagsDto)
  tags: TagsDto;

  /** Session to post the crawl's progress card into. */
  @IsOptional()
  @IsUUID()
  chatSessionId?: string;
}

export class ResolveDto {
  @Transform(trimmed)
  @IsString()
  @Length(2, 80)
  query: string;
}
