import { app } from 'electron';
import { XpcMainHandler } from 'electron-xpc/main';
import { chmodSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import {
  createMcpConfigJson,
  createPosixMcpShim,
  createWindowsMcpShim,
  getMcpBridgeEndpoint,
  getMcpServerName,
  getMcpShimPath,
  type McpIntegrationInfo,
} from '@shared/mcp/mcpBridge.shared';
import {
  createTodoAgentSetupInstruction,
  requireTodoAgentSkillPath,
  resolveTodoAgentSkillPath,
} from '../mcp/mcpAgentOnboarding.service';

class McpHandler extends XpcMainHandler {
  async getIntegrationInfo(): Promise<McpIntegrationInfo> {
    const commandPath = await this.ensureShim();
    const endpoint = getMcpBridgeEndpoint(app.getPath('userData'));
    const serverName = getMcpServerName(app.getName());
    const configJson = createMcpConfigJson(commandPath, serverName);
    const skillPath = requireTodoAgentSkillPath(
      resolveTodoAgentSkillPath({
        appPath: app.getAppPath(),
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
      }),
    );
    const instruction = createTodoAgentSetupInstruction({ configJson, serverName, skillPath });

    return {
      serverName,
      commandPath,
      configJson,
      skillPath,
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
    const endpoint = getMcpBridgeEndpoint(app.getPath('userData'));
    return createPosixMcpShim(
      process.execPath,
      join(app.getAppPath(), 'out', 'main', 'mcpHelper.js'),
      endpoint.path,
    );
  }

  private createWindowsShim(): string {
    const endpoint = getMcpBridgeEndpoint(app.getPath('userData'));
    return createWindowsMcpShim(
      process.execPath,
      join(app.getAppPath(), 'out', 'main', 'mcpHelper.js'),
      endpoint.path,
    );
  }
}

export const mcpHandler = new McpHandler();
export type { McpHandler };
