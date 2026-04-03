import { messageDao } from '../dao/message.dao';
import { settingDao } from '../dao/setting.dao';
import { langGraphHelper } from '../../base/langGraph/langGraph.helper';
import type { ChatMessageInput, ModelConfig } from '../../base/langGraph/langGraph.helper';
import type { ProxyConfig } from '../../base/langGraph/model.adaptor';
import { xpcRenderer } from 'electron-xpc/preload';
import { sqliteManager } from '../sqliteHelper/sqlite.manager';

interface ProxySetting {
  switch: boolean;
  ip: string;
  port: string;
}

interface SystemPromptSetting {
  content: string;
}

const getProxyConfig = async (): Promise<ProxyConfig | undefined> => {
  const proxySetting = await settingDao.get<ProxySetting>({ key: 'PROXY' });
  if (proxySetting?.switch && proxySetting.ip && proxySetting.port) {
    return { ip: proxySetting.ip, port: proxySetting.port };
  }
  return undefined;
};

const getSystemPrompt = async (): Promise<string> => {
  const systemPromptSetting = await settingDao.get<SystemPromptSetting>({ key: 'sys_prompt' });
  if (systemPromptSetting?.content) {
    return systemPromptSetting.content;
  }
  return "I'm AI assistant.";
};

let currentAbortController: AbortController | null = null;
let isSqliteInitialized = false;

const sendMessage = async (sessionId: string): Promise<void> => {
  try {
    // Build message history for LangGraph
    const rows = await messageDao.getHistoryBySessionId({ sessionId });
    const messages: ChatMessageInput[] = rows.map((r) => ({
      role: r.role as ChatMessageInput['role'],
      content: r.content as string,
    }));

    // Prepend system prompt
    const systemPrompt = await getSystemPrompt();
    messages.unshift({
      role: 'system',
      content: systemPrompt,
    });

    // Get LLM config
    const llmConfig = await settingDao.get<ModelConfig>({ key: 'LLM' });
    if (!llmConfig?.provider || !llmConfig?.model || !llmConfig?.apiKey) {
      console.error('[messageServer] LLM config not set');
      xpcRenderer.send('chat/stream/done', { sessionId, content: '', error: 'LLM config not set' });
      return;
    }

    const proxy = await getProxyConfig();
    currentAbortController = new AbortController();
    const { signal } = currentAbortController;

    const fullContent = await langGraphHelper.streamChat(messages, {
      onChunk: (chunk) => {
        if (signal.aborted) throw new Error('AbortError');
        xpcRenderer.send('chat/stream/chunk', { sessionId, chunk });
      },
      config: { ...llmConfig as ModelConfig, ...(proxy ? { proxy } : {}) },
      signal,
    });

    console.log('[messageServer] streamChat done, fullContent length:', fullContent.length);
    const insertedMessage = await messageDao.insert({ sessionId, role: 'assistant', content: fullContent });
    xpcRenderer.send('chat/stream/done', { 
      sessionId, 
      content: fullContent,
      message: {
        id: insertedMessage.id,
        sessionId: insertedMessage.session_id,
        role: insertedMessage.role,
        content: insertedMessage.content,
        createdAt: insertedMessage.created_at,
      },
    });
    console.log('[messageServer] sent chat/stream/done with message id:', insertedMessage.id);
  } catch (err: any) {
    if (err.message === 'AbortError' || err.name === 'AbortError' || currentAbortController?.signal.aborted) {
      xpcRenderer.send('chat/stream/done', { sessionId, content: '' });
    } else {
      console.error('[messageServer] streamChat error:', err.message, err.stack);
      xpcRenderer.send('chat/stream/done', { sessionId, content: '', error: err.message });
    }
  }
};

export const initMessageServer = async (): Promise<void> => {
  try {
    await sqliteManager.init();
    isSqliteInitialized = true;
  } catch (err: any) {
    isSqliteInitialized = false;
    console.error('[messageServer] SQLite initialization failed:', err.message);
    throw new Error(`SQLite initialization failed: ${err.message}`);
  }
  xpcRenderer.handle('chat/stop', async () => {
    currentAbortController?.abort();
    currentAbortController = null;
    return 'ok';
  });

  xpcRenderer.handle('chat/send', async (payload) => {
    if (!isSqliteInitialized) {
      const errorMsg = 'SQLite database is not initialized';
      console.error('[messageServer]', errorMsg);
      const { sessionId } = payload.params || {};
      if (sessionId) {
        xpcRenderer.send('chat/stream/done', { sessionId, content: '', error: errorMsg });
      }
      return null;
    }

    const { sessionId, content } = payload.params || {};
    if (!sessionId || !content) {
      console.error('[messageServer] missing sessionId or content');
      return null;
    }

    // Insert user message and return immediately
    const insertedMessage = await messageDao.insert({ sessionId, role: 'user', content });

    // Process AI response asynchronously
    sendMessage(sessionId);

    // Return inserted message data immediately
    return insertedMessage;
  });

  console.log('[messageServer] initialized');
};
