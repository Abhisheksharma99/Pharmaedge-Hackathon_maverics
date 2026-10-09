import { TrimString } from '../../auth/dto/login.dto.js';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ROLES_LIST, type Role } from '../../auth/auth.types.js';

export class CreateUserDto {
  @TrimString()
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  password: string;

  @IsIn(ROLES_LIST)
  role: Role;
}

export class UpdateUserDto {
  @IsOptional()
  @IsIn(ROLES_LIST)
  role?: Role;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
