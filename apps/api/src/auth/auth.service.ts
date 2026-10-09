import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { toPublicUser, UsersService, type PublicUser, type UserDoc } from '../users/users.service.js';
import type { AccessTokenPayload } from './auth.types.js';
import { RefreshTokenStore } from './refresh-token.store.js';

export interface Session {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

const INVALID_CREDENTIALS = { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' };

@Injectable()
export class AuthService {
  // Hash checked when the email is unknown, so response time doesn't reveal whether an account exists.
  private readonly dummyHash = argon2.hash('timing-equaliser-password', { type: argon2.argon2id });

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenStore,
  ) {}

  async login(email: string, password: string): Promise<Session> {
    this.refreshTokens.ensureAvailable();
    const user = await this.users.findByEmail(email);
    const valid = user
      ? await this.users.verifyPassword(user, password)
      : await argon2.verify(await this.dummyHash, password);
    if (!user || !valid || !user.active) throw new UnauthorizedException(INVALID_CREDENTIALS);
    return {
      user: toPublicUser(user),
      accessToken: await this.signAccess(user),
      refreshToken: await this.refreshTokens.issue(user._id.toHexString()),
    };
  }

  /** Rotate the refresh token and re-read the user, so role changes and deactivation apply. */
  async refresh(refreshToken: string | undefined): Promise<Session> {
    if (!refreshToken) {
      throw new UnauthorizedException({ code: 'REFRESH_INVALID', message: 'Session expired. Please sign in again.' });
    }
    const rotated = await this.refreshTokens.rotate(refreshToken);
    const user = await this.users.findById(rotated.userId);
    if (!user || !user.active) {
      await this.refreshTokens.revokeFamily(rotated.familyId);
      throw new UnauthorizedException({ code: 'USER_INACTIVE', message: 'This account is no longer active' });
    }
    return { user: toPublicUser(user), accessToken: await this.signAccess(user), refreshToken: rotated.token };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    try {
      await this.refreshTokens.revoke(refreshToken);
    } catch {
      // Logging out must always succeed for the user; the token expires on its own.
    }
  }

  /** Fresh profile for the signed-in user (role may have changed since the token was issued). */
  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user || !user.active) {
      throw new UnauthorizedException({ code: 'USER_INACTIVE', message: 'This account is no longer active' });
    }
    return toPublicUser(user);
  }

  signAccess(user: UserDoc): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: user._id.toHexString(),
      email: user.email,
      name: user.name,
      role: user.role,
    };
    return this.jwt.signAsync(payload);
  }
}
