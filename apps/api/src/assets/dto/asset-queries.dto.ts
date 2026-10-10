import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const csv = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter(Boolean) : value;
const bool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class TimelineQueryDto {
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsIn(['regulatory', 'clinical', 'safety', 'company', 'ip'], { each: true })
  category?: string[];

  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsIn(['High', 'Medium', 'Low'], { each: true })
  significance?: string[];

  /** only = upcoming milestones only; exclude = history only. */
  @IsOptional()
  @IsIn(['only', 'exclude'])
  milestones?: 'only' | 'exclude';

  /** Only trials sponsored by the asset's company (drops investigator / competitor studies). */
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  companyOnly?: boolean;

  @IsOptional()
  @Matches(ISO_DATE)
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE)
  to?: string;

  /** key = the curated key events (spec §4.1); all (default) = everything. */
  @IsOptional()
  @IsIn(['key', 'all'])
  scope?: 'key' | 'all';

  /** notes = merge the team's notes (via 'user'). */
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsIn(['notes'], { each: true })
  include?: string[];

  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsString({ each: true })
  branch?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limit = 500;
}

export class MarketQueryDto {
  /** Other tracked drugs of the same listed company to include (asset ids; ones under another ticker are ignored). */
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  drugs?: string[];

  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsIn(['regulatory', 'clinical', 'safety', 'company', 'ip'], { each: true })
  category?: string[];

  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsIn(['High', 'Medium', 'Low'], { each: true })
  significance?: string[];

  @IsOptional()
  @Matches(ISO_DATE)
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE)
  to?: string;
}

export class StoryQueryDto {
  @IsOptional()
  @Matches(ISO_DATE)
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE)
  to?: string;

  /** Focus window: what changed since this date. */
  @IsOptional()
  @Matches(ISO_DATE)
  since?: string;

  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsIn(['regulatory', 'clinical', 'safety', 'company', 'ip'], { each: true })
  category?: string[];

  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsIn(['High', 'Medium', 'Low'], { each: true })
  significance?: string[];

  /** Another asset to compare journeys with. */
  @IsOptional()
  @Matches(/^[a-z0-9-]{1,80}$/)
  compare?: string;
}

export class ChangesQueryDto {
  @IsOptional()
  @Matches(ISO_DATE)
  since?: string;
}

export class RecordsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  /** Filter on record_type (e.g. fda_submission, ema_epar, press_release). */
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsString({ each: true })
  type?: string[];

  /** Trials: phase values as stored (PHASE1..PHASE4). */
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsString({ each: true })
  phase?: string[];

  /** Trials: overall_status values (RECRUITING, COMPLETED, ...). */
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsString({ each: true })
  status?: string[];

  /** Company records: only those mentioning one of the asset's names. */
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  mentionsOnly?: boolean;

  /** Trials: only studies whose lead sponsor is the asset's company. */
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  companyOnly?: boolean;

  /** Facet selections as JSON `{"journal":"Lancet"}` (keys: the tab's facets, see the `facets` of the response). */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  facets?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}

export class RecordQueryDto {
  @IsString()
  @MaxLength(2000)
  key: string;
}

export class LedgerQueryDto {
  @IsOptional()
  @IsIn(['ingest', 'headline', 'skip'])
  decision?: string;

  @IsOptional()
  @Matches(/^[a-z_]{1,40}$/)
  collection?: string;

  @IsOptional()
  @Matches(/^[a-z_]{1,40}$/)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}
