import { StateGraph, MessagesAnnotation, START, END } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { HumanMessage, SystemMessage, AIMessageChunk } from '@langchain/core/messages';
import type { AIMessage } from '@langchain/core/messages';
import { createModel } from './model.adaptor';
import type { ModelConfig } from './model.adaptor';
import { createAllSkills, allSkillNames, SKILL_PROMPT } from './defaultSkills/skill.registry';
import { defaultPrompt } from './defaultPrompt';
import type { ProxyConfig } from './model.adaptor';

export type { ModelConfig };

export interface ChatMessageInput {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

class LangGraphHelper {
  private currentConfig: ModelConfig | null = null;

  private buildGraph(
    config: ModelConfig,
    skillNames: string[],
    proxy?: ProxyConfig,
    onToolCall?: (name: string, input: Record<string, unknown>) => void,
    signal?: AbortSignal,
  ) {
    const model = createModel(config);
    const allSkills = createAllSkills(proxy);
    const selectedSkills = skillNames.map((name) => allSkills[name]).filter(Boolean);
    const hasTools = selectedSkills.length > 0;
    const modelWithTools = hasTools ? model.bindTools(selectedSkills) : model;
    const toolNode = hasTools ? new ToolNode(selectedSkills) : null;

    const TOOL_SYSTEM = new SystemMessage(`${defaultPrompt}

${SKILL_PROMPT}`);

    const callModel = async (state: typeof MessagesAnnotation.State) => {
      const msgs = state.messages[0]?._getType() === 'system'
        ? state.messages
        : [TOOL_SYSTEM, ...state.messages];

      for (const m of msgs) {
        const type = m._getType();
        const content = typeof m.content === 'string' ? m.content.slice(0, 200) : JSON.stringify(m.content).slice(0, 200);
        const toolCalls = (m as any).tool_calls?.length ? ` tool_calls:${JSON.stringify((m as any).tool_calls)}` : '';
        const toolCallId = (m as any).tool_call_id ? ` tool_call_id:${(m as any).tool_call_id}` : '';
        console.log(`  [${type}]${toolCallId}${toolCalls} ${content}`);
      }
      const response = await modelWithTools.invoke(msgs);

      return { messages: [response] };
    };

    const shouldContinue = (state: typeof MessagesAnnotation.State) => {
      if (signal?.aborted) {
        console.log('[graph] aborted, stopping');
        return END;
      }
      const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
      if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) return END;

      const prevMessages = state.messages.slice(0, -1);
      const calledPageUrls = new Set(
        prevMessages
          .filter((m) => m._getType() === 'ai')
          .flatMap((m: any) => (m.tool_calls ?? []) as Array<{ name: string; args: Record<string, unknown> }>)
          .filter((tc) => tc.name === 'fetch_page')
          .map((tc) => String(tc.args?.url ?? '')),
      );

      const newCalls = lastMessage.tool_calls.filter((tc) => {
        if (tc.name === 'fetch_page') {
          const url = String(tc.args?.url ?? '');
          if (calledPageUrls.has(url)) {
            console.log('[graph] skipping already fetched url:', url);
            return false;
          }
        }
        return true;
      });

      if (newCalls.length === 0) {
        console.log('[graph] all tool calls already executed, stopping loop');
        return END;
      }
      for (const tc of newCalls) {
        console.log('[graph] skill call detected:', tc.name, tc.args);
        onToolCall?.(tc.name, tc.args as Record<string, unknown>);
      }
      return 'tools';
    };

    const graph = new StateGraph(MessagesAnnotation)
      .addNode('callModel', callModel)
      .addEdge(START, 'callModel');

    if (hasTools && toolNode) {
      graph
        .addNode('tools', toolNode)
        .addConditionalEdges('callModel', shouldContinue)
        .addEdge('tools', 'callModel');
    } else {
      graph.addEdge('callModel', END);
    }

    return graph.compile();
  }

  private toMessages(inputs: ChatMessageInput[]) {
    return inputs.map((m) => {
      if (m.role === 'system') return new SystemMessage(m.content);
      if (m.role === 'assistant') return new AIMessageChunk(m.content);
      return new HumanMessage(m.content);
    });
  }

  updateModel(config: ModelConfig): void {
    this.currentConfig = config;
  }

  async streamChat(
    messages: ChatMessageInput[],
    options: {
      onChunk: (token: string) => void;
      onToolCall?: (name: string, input: Record<string, unknown>) => void;
      config: ModelConfig;
      signal?: AbortSignal;
    },
  ): Promise<string> {
    const effectiveConfig = this.currentConfig || options.config;
    console.log('streamChat', effectiveConfig);

    const proxy = effectiveConfig.proxy;
    const totalT0 = Date.now();
    console.log('[langGraph] building graph with all skills:', allSkillNames);

    const graph = this.buildGraph(effectiveConfig, [...allSkillNames], proxy, options.onToolCall, options.signal);
    let fullContent = '';

    const finalMessages = this.toMessages(messages);

    const stream = await graph.stream(
      { messages: finalMessages },
      { streamMode: 'messages', signal: options.signal },
    );

    for await (const [messageChunk, metadata] of stream) {
      if (options.signal?.aborted) break;
      if (!messageChunk) continue;
      const msgType = messageChunk._getType ? messageChunk._getType() : 'unknown';
      const toolCalls = (messageChunk as AIMessage).tool_calls?.length ?? 0;
      console.log('[streamChat] chunk type:', msgType, 'toolCalls:', toolCalls, 'node:', (metadata as any)?.langgraph_node);
      if (toolCalls > 0) continue;
      if (msgType === 'tool') continue;
      const content = typeof messageChunk.content === 'string' ? messageChunk.content : '';
      if (content) {
        fullContent += content;
        options.onChunk(content);
      }
    }
    console.log(`[streamChat] stream finished, fullContent length: ${fullContent.length}, total elapsed: ${Date.now() - totalT0}ms`);

    return fullContent;
  }
}

export const langGraphHelper = new LangGraphHelper();
