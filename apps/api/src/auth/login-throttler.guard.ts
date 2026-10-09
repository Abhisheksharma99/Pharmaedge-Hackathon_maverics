import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { normalizeEmail } from '../users/users.service.js';

/** Login attempts are limited per IP + email, so one user can't lock out a shared office IP. */
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const email = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
    return `${req.ip}:${email}`;
  }
}
