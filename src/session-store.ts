import { randomUUID } from "node:crypto";

import { SESSIONS_FILE_NAME, dataFilePath } from "./config";
import { pathExists, readJsonFile, writeJsonFile } from "./fs-utils";
import type { SessionQueryEntry, SessionRecord, SessionStoreFile } from "./types";

const STORE_VERSION = 1;

export class SessionStore {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  async appendQuery(query: string, topResultPaths: string[]): Promise<SessionRecord> {
    const store = await this.loadStore();
    const now = new Date().toISOString();
    const entry: SessionQueryEntry = {
      at: now,
      query,
      topResultPaths
    };

    let session = store.sessions[store.sessions.length - 1];
    if (!session) {
      session = {
        id: randomUUID(),
        startedAt: now,
        lastUpdatedAt: now,
        entries: []
      };
      store.sessions.push(session);
    }

    session.entries.push(entry);
    session.lastUpdatedAt = now;

    await this.saveStore(store);
    return session;
  }

  async getLatestSession(): Promise<SessionRecord | null> {
    const store = await this.loadStore();
    return store.sessions[store.sessions.length - 1] ?? null;
  }

  private async loadStore(): Promise<SessionStoreFile> {
    const storePath = dataFilePath(this.workspaceRoot, SESSIONS_FILE_NAME);
    const exists = await pathExists(storePath);
    if (!exists) {
      return { version: STORE_VERSION, sessions: [] };
    }

    const parsed = await readJsonFile<SessionStoreFile>(storePath);
    if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.sessions)) {
      return { version: STORE_VERSION, sessions: [] };
    }
    return parsed;
  }

  private async saveStore(store: SessionStoreFile): Promise<void> {
    const storePath = dataFilePath(this.workspaceRoot, SESSIONS_FILE_NAME);
    await writeJsonFile(storePath, store);
  }
}
