import { app } from 'electron';
import { XpcMainHandler } from 'electron-xpc/main';
import { chmodSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import {
  createMcpConfigJson,
  getMcpBridgeEndpoint,
  getMcpShimPath,
  type McpIntegrationInfo,
} from '@shared/mcp/mcpBridge.shared';

const shellQuote = (value: string): string => {
  return `'${value.replace(/'/g, `'\\''`)}'`;
};

class McpHandler extends XpcMainHandler {
  async getIntegrationInfo(): Promise<McpIntegrationInfo> {
    const commandPath = await this.ensureShim();
    const endpoint = getMcpBridgeEndpoint(app.getPath('userData'));
    const configJson = createMcpConfigJson(commandPath);
    const instruction = `把这段 MCP 配置添加到你的 agent 应用，然后保持 Bitterless 正在运行：\n\n${configJson}`;

    return {
      commandPath,
      configJson,
      instruction,
      bridgePath: endpoint.path,
      transport: endpoint.transport,
    };
  }

  async ensureShim(): Promise<string> {
    const userDataPath = app.getPath('userData');
    const shimPath = getMcpShimPath(userDataPath);
    mkdirSync(dirname(shimPath), { recursive: true });

    if (process.platform === 'win32') {
      writeFileSync(shimPath, this.createWindowsShim(), 'utf8');
      return shimPath;
    }

    writeFileSync(shimPath, this.createPosixShim(), 'utf8');
    chmodSync(shimPath, 0o755);
    return shimPath;
  }

  private createPosixShim(): string {
    const execPath = shellQuote(process.execPath);
    if (app.isPackaged) {
      return `#!/bin/sh\nexec ${execPath} --mcp-helper "$@"\n`;
    }

    return `#!/bin/sh\nexec ${execPath} ${shellQuote(app.getAppPath())} --mcp-helper "$@"\n`;
  }

  private createWindowsShim(): string {
    const execPath = `"${process.execPath}"`;
    if (app.isPackaged) {
      return `@echo off\r\n${execPath} --mcp-helper %*\r\n`;
    }

    return `@echo off\r\n${execPath} "${app.getAppPath()}" --mcp-helper %*\r\n`;
  }
}

export const mcpHandler = new McpHandler();
export type { McpHandler };
