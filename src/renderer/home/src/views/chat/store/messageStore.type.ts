export interface ChatMessage {
  id?: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string | number;
}
