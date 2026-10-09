import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import argon2 from 'argon2';
import { Collection, Db, MongoServerError, ObjectId } from 'mongodb';
import type { Role } from '../auth/auth.types.js';
import type { Env } from '../config/env.js';
import { MONGO_DB } from '../database/database.module.js';

export interface UserDoc {
  _id: ObjectId;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** A user as returned by the API — never includes the password hash. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const toPublicUser = (u: UserDoc): PublicUser => ({
  id: u._id.toHexString(),
  email: u.email,
  name: u.name,
  role: u.role,
  active: u.active,
  createdAt: u.createdAt.toISOString(),
});

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name);
  private readonly users: Collection<UserDoc>;

  constructor(
    @Inject(MONGO_DB) db: Db,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.users = db.collection<UserDoc>('users');
  }

  async onApplicationBootstrap() {
    await this.users.createIndex({ email: 1 }, { unique: true });
    await this.seedAdmin();
  }

  /** Create the first admin from env when no admin exists yet. */
  private async seedAdmin() {
    if (await this.users.countDocuments({ role: 'admin' }, { limit: 1 })) return;
    await this.create({
      email: this.config.get('ADMIN_EMAIL', { infer: true }),
      password: this.config.get('ADMIN_PASSWORD', { infer: true }),
      name: this.config.get('ADMIN_NAME', { infer: true }),
      role: 'admin',
    });
    this.logger.log('Seeded admin user from ADMIN_EMAIL');
  }

  async create(input: { email: string; name: string; password: string; role: Role }): Promise<PublicUser> {
    const now = new Date();
    const doc: UserDoc = {
      _id: new ObjectId(),
      email: normalizeEmail(input.email),
      name: input.name.trim(),
      passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }),
      role: input.role,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.users.insertOne(doc);
    } catch (err) {
      if (err instanceof MongoServerError && err.code === 11000) {
        throw new ConflictException({ code: 'USER_EXISTS', message: 'A user with this email already exists' });
      }
      throw err;
    }
    return toPublicUser(doc);
  }

  findByEmail(email: string): Promise<UserDoc | null> {
    return this.users.findOne({ email: normalizeEmail(email) });
  }

  async findById(id: string): Promise<UserDoc | null> {
    if (!ObjectId.isValid(id)) return null;
    return this.users.findOne({ _id: new ObjectId(id) });
  }

  verifyPassword(user: UserDoc, password: string): Promise<boolean> {
    return argon2.verify(user.passwordHash, password);
  }

  async list(): Promise<PublicUser[]> {
    const docs = await this.users.find().sort({ createdAt: 1 }).toArray();
    return docs.map(toPublicUser);
  }

  /** Change role / active flag. Admins cannot demote or deactivate themselves (avoids lock-out). */
  async update(actorId: string, id: string, changes: { role?: Role; active?: boolean }): Promise<PublicUser> {
    if (actorId === id && (changes.role === 'analyst' || changes.active === false)) {
      throw new BadRequestException({
        code: 'CANNOT_MODIFY_SELF',
        message: 'You cannot demote or deactivate your own account',
      });
    }
    const updated = ObjectId.isValid(id)
      ? await this.users.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: { ...changes, updatedAt: new Date() } },
          { returnDocument: 'after' },
        )
      : null;
    if (!updated) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    return toPublicUser(updated);
  }
}
