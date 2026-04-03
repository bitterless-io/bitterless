import { createXpcRendererEmitter } from 'electron-xpc/renderer';

interface SessionInsertParams {
  sessionId: string;
  title?: string;
  platform?: string;
}

interface SessionRow {
  id: number;
  session_id: string;
  platform: string;
  title: string;
  pinned: number;
  pinned_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SessionDaoType {
  create: (params: SessionInsertParams) => Promise<SessionRow | undefined>;
  getAll: () => Promise<SessionRow[]>;
  getBySessionId: (params: { sessionId: string }) => Promise<SessionRow | undefined>;
  updateTitle: (params: { sessionId: string; title: string }) => Promise<void>;
  touch: (params: { sessionId: string }) => Promise<void>;
  pin: (params: { sessionId: string }) => Promise<void>;
  unpin: (params: { sessionId: string }) => Promise<void>;
  delete: (params: { sessionId: string }) => Promise<void>;
}

export const sessionEmitter = createXpcRendererEmitter<SessionDaoType>('SessionDao');
