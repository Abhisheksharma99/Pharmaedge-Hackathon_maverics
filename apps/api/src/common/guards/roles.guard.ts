import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser, Role } from '../../auth/auth.types.js';
import { ROLES } from '../decorators/auth.decorators.js';

/** Enforces @Roles(...) after JwtAuthGuard has attached the user. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;
    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (user && roles.includes(user.role)) return true;
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have access to this' });
  }
}
