import { reactive, computed } from 'vue';
import { idHelper } from '@shared/idHelper/shared/id.helper';
import { sessionEmitter } from '@/emitter/session.emitter';

export interface SessionItem {
  sessionId: string;
  title: string;
  pinned: boolean;
  pinnedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

class SessionStore {
  sessionList: SessionItem[] = [];
  currentSessionId = '';
  pendingSessionId = '';
  loading = false;
  showHistory = false;
}

export const sessionStore = reactive<SessionStore>(new SessionStore());

export const currentSession = computed(() => 
  sessionStore.sessionList.find((s) => s.sessionId === sessionStore.currentSessionId)
);

/** Load all sessions from DB */
export const loadSessions = async (): Promise<void> => {
  sessionStore.loading = true;
  const result = await sessionEmitter.getAll();
  if (Array.isArray(result)) {
    sessionStore.sessionList = result.map((row: any) => ({
      sessionId: row.session_id,
      title: row.title,
      pinned: row.pinned === 1,
      pinnedAt: row.pinned_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
  sessionStore.loading = false;
};

/** Start a new session in the frontend only (no DB write) */
export const startNewSession = (): void => {
  const sessionId = idHelper.genSessionId();
  sessionStore.pendingSessionId = sessionId;
  sessionStore.currentSessionId = '';
};

/** Persist the pending session to DB with a title, then select it */
export const createSession = async (title: string): Promise<string> => {
  const sessionId = sessionStore.pendingSessionId || idHelper.genSessionId();
  await sessionEmitter.create({ sessionId, title });
  await loadSessions();
  sessionStore.currentSessionId = sessionId;
  sessionStore.pendingSessionId = '';
  return sessionId;
};

/** Select a session */
export const selectSession = (sessionId: string): void => {
  sessionStore.currentSessionId = sessionId;
  sessionStore.showHistory = false;
};

/** Delete a session */
export const deleteSession = async (sessionId: string): Promise<void> => {
  await sessionEmitter.delete({ sessionId });
  if (sessionStore.currentSessionId === sessionId) {
    sessionStore.currentSessionId = '';
  }
  await loadSessions();
};

/** Rename a session */
export const renameSession = async (sessionId: string, title: string): Promise<void> => {
  await sessionEmitter.updateTitle({ sessionId, title });
  await loadSessions();
};

/** Pin a session */
export const pinSession = async (sessionId: string): Promise<void> => {
  await sessionEmitter.pin({ sessionId });
  await loadSessions();
};

/** Unpin a session */
export const unpinSession = async (sessionId: string): Promise<void> => {
  await sessionEmitter.unpin({ sessionId });
  await loadSessions();
};

/** Touch session updated_at (e.g. after sending a message) */
export const touchSession = async (sessionId: string): Promise<void> => {
  await sessionEmitter.touch({ sessionId });
};
