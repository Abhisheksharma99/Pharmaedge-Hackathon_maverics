import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/** Pasted emails often carry stray spaces; trim before validating. */
export const TrimString = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export class LoginDto {
  @TrimString()
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password: string;
}
