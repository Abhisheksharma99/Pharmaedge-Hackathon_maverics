import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Env } from '../config/env.js';
import { ValkeyService } from '../valkey/valkey.service.js';

interface StoredToken {
  userId: string;
  familyId: string;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Opaque refresh tokens in Valkey, stored only as hashes.
 *
 * Every refresh rotates the token. Tokens from one login share a family; using
 * an already-rotated token again (a sign of theft) revokes the whole family.
 * Unlike the cache, this store refuses to work without Valkey.
 */
@Injectable()
export class RefreshTokenStore {
  private readonly ttlSeconds: number;

  constructor(
    private readonly valkey: ValkeyService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlSeconds = config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 24 * 3600;
  }

  /** Throw a clear 503 before any work when sessions cannot be stored. */
  ensureAvailable(): void {
    if (!this.valkey.isAvailable()) {
      throw new ServiceUnavailableException({
        code: 'AUTH_STORE_UNAVAILABLE',
        message: 'Sign-in is temporarily unavailable. Please try again shortly.',
      });
    }
  }

  async issue(userId: string, familyId: string = randomUUID()): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.run((c) =>
      c
        .multi()
        .set(this.valkey.key('rt', sha256(token)), JSON.stringify({ userId, familyId }), 'EX', this.ttlSeconds)
        .set(this.valkey.key('rtf', familyId), userId, 'EX', this.ttlSeconds)
        .exec(),
    );
    return token;
  }

  /** Consume a refresh token and return its owner plus a replacement token. */
  async rotate(token: string): Promise<StoredToken & { token: string }> {
    const hash = sha256(token);
    const raw = await this.run((c) => c.getdel(this.valkey.key('rt', hash)));
    if (!raw) {
      const reusedFamily = await this.run((c) => c.get(this.valkey.key('rtu', hash)));
      if (reusedFamily) {
        await this.revokeFamily(reusedFamily);
        throw new UnauthorizedException({ code: 'REFRESH_REUSED', message: 'Session revoked. Please sign in again.' });
      }
      throw new UnauthorizedException({ code: 'REFRESH_INVALID', message: 'Session expired. Please sign in again.' });
    }
    const stored = JSON.parse(raw) as StoredToken;
    const familyActive = await this.run((c) => c.exists(this.valkey.key('rtf', stored.familyId)));
    if (!familyActive) {
      throw new UnauthorizedException({ code: 'REFRESH_INVALID', message: 'Session expired. Please sign in again.' });
    }
    // Remember the spent token so a replay can be detected.
    await this.run((c) => c.set(this.valkey.key('rtu', hash), stored.familyId, 'EX', this.ttlSeconds));
    return { ...stored, token: await this.issue(stored.userId, stored.familyId) };
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.run((c) => c.del(this.valkey.key('rtf', familyId)));
  }

  /** Revoke the session a token belongs to. Unknown tokens are ignored. */
  async revoke(token: string): Promise<void> {
    const raw = await this.run((c) => c.getdel(this.valkey.key('rt', sha256(token))));
    if (raw) await this.revokeFamily((JSON.parse(raw) as StoredToken).familyId);
  }

  private async run<T>(fn: (client: ValkeyService['client']) => Promise<T>): Promise<T> {
    this.ensureAvailable();
    try {
      return await fn(this.valkey.client);
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new ServiceUnavailableException({
        code: 'AUTH_STORE_UNAVAILABLE',
        message: 'Sign-in is temporarily unavailable. Please try again shortly.',
      });
    }
  }
}
