import { randomUUID } from 'node:crypto';
import type { Db } from 'mongodb';
import type { ChatMessageDoc, ChatSessionDoc } from './chat.types.js';

/**
 * Chat persistence as plain functions over the database, so the assets module
 * can post into a session (the job card after "Confirm & start crawl")
 * without depending on the chat module.
 */

export const sessions = (db: Db) => db.collection<ChatSessionDoc>('chat_sessions');
export const messages = (db: Db) => db.collection<ChatMessageDoc>('chat_messages');

export async function ensureChatIndexes(db: Db): Promise<void> {
  await sessions(db).createIndex({ user_id: 1, updated_at: -1 });
  await messages(db).createIndex({ session_id: 1, created_at: 1 });
}

/** The user's own session, or null (another user's session is indistinguishable from a missing one). */
export function findSession(db: Db, sessionId: string, userId: string) {
  return sessions(db).findOne({ _id: sessionId, user_id: userId });
}

export async function addMessage(
  db: Db,
  session: Pick<ChatSessionDoc, '_id' | 'user_id'>,
  fields: Omit<ChatMessageDoc, '_id' | 'session_id' | 'user_id' | 'created_at' | 'cards' | 'citations' | 'follow_ups'> &
    Partial<Pick<ChatMessageDoc, 'cards' | 'citations' | 'follow_ups'>>,
): Promise<ChatMessageDoc> {
  const doc: ChatMessageDoc = {
    _id: randomUUID(),
    session_id: session._id,
    user_id: session.user_id,
    cards: [],
    citations: [],
    follow_ups: [],
    ...fields,
    created_at: new Date(),
  };
  await messages(db).insertOne(doc);
  await sessions(db).updateOne({ _id: session._id }, { $set: { updated_at: doc.created_at } });
  return doc;
}
