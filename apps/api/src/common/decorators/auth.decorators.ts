import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthUser, Role } from '../../auth/auth.types.js';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/** Opt a route out of the global JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restrict a route to the given roles (checked after authentication). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** The authenticated user attached by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
