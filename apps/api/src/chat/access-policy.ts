import { Inject, Injectable } from '@nestjs/common';
import type { Db } from 'mongodb';
import type { AssetDoc } from '../assets/assets.service.js';
import { MONGO_DB } from '../database/database.module.js';

/**
 * Which assets a user's Asset AI turn may read - decided here, on the server, before any tool queries data; never
 * by the model's arguments.
 *
 * Policy (documented in apps/README.md): SINGLE TEAM. Every authenticated user may read every tracked asset, as on
 * the rest of the platform (assets have no per-user or per-team ACL). The chat still enforces scope explicitly -
 * every tool checks requested assets against this set, and evidence search always filters to it - so moving to a
 * multi-tenant policy is a change to this one class (e.g. filter by an `acl`/team field), not to the tools.
 */
@Injectable()
export class AccessPolicy {
  constructor(@Inject(MONGO_DB) private readonly db: Db) {}

  async allowedAssets(_userId: string): Promise<Set<string>> {
    const ids = await this.db.collection<AssetDoc>('assets').find({}, { projection: { _id: 1 } }).toArray();
    return new Set(ids.map((a) => a._id));
  }
}
