import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src')
const maestroWindow = readFileSync(join(root, 'main/maestro/windows/maestroWindow.helper.ts'), 'utf8')
const coachApi = readFileSync(join(root, 'shared/maestro/coach.api.ts'), 'utf8')
const configApi = readFileSync(join(root, 'shared/maestro/config.api.ts'), 'utf8')
const coachHandler = readFileSync(join(root, 'main/maestro/xpc/coach.handler.ts'), 'utf8')
const messageStore = readFileSync(join(root, 'renderer/maestro/control/src/store/message.store.ts'), 'utf8')
const messageType = readFileSync(join(root, 'renderer/maestro/control/src/store/message.type.ts'), 'utf8')
const chatPanel = readFileSync(join(root, 'renderer/maestro/control/src/ChatPanel.vue'), 'utf8')
const messageItem = readFileSync(join(root, 'renderer/maestro/control/src/MessageItem.vue'), 'utf8')
const maestroPrompt = readFileSync(join(root, 'main/maestro/agent/prompt/maestroSysPrompt.ts'), 'utf8')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const sliceBetween = (source, start, end) => {
  const from = source.indexOf(start)
  assert(from >= 0, `missing start marker: ${start}`)
  const to = source.indexOf(end, from + start.length)
  assert(to > from, `missing end marker after: ${start}`)
  return source.slice(from, to)
}

assert(configApi.includes("export const WORKSPACE_CONFIG_DOMAIN = 'workspace'"), 'workspace default should persist in config domain workspace')
assert(configApi.includes("export const WORKSPACE_DEFAULT_KEY = 'default'"), 'workspace default should persist under key default')

for (const method of ['chooseWorkspaceDirectory', 'setWorkspaceDirectory', 'getWorkspaceDirectory']) {
  assert(coachApi.includes(`${method}(`), `shared XPC API should expose ${method}`)
  assert(coachHandler.includes(`async ${method}`), `XPC handler should forward ${method}`)
  assert(maestroWindow.includes(`async ${method}`), `main helper should implement ${method}`)
}
assert(coachApi.includes('attachClipboardImage'), 'shared XPC API should expose clipboard image materialization')
assert(coachHandler.includes('async attachClipboardImage'), 'XPC handler should forward clipboard image materialization')
assert(maestroWindow.includes('async attachClipboardImage'), 'main helper should materialize clipboard screenshots')

assert(maestroWindow.includes("properties: ['openDirectory', 'createDirectory']"), 'workspace picker should select directories')
assert(maestroWindow.includes("configStore.upsert({ domain: WORKSPACE_CONFIG_DOMAIN, key: WORKSPACE_DEFAULT_KEY"), 'main should persist the app-wide default workspace')
assert(maestroWindow.includes("configStore.remove({ domain: WORKSPACE_CONFIG_DOMAIN, key: WORKSPACE_DEFAULT_KEY"), 'main should remove stale/cleared default workspace')
assert(maestroWindow.includes("xpcMain.broadcast('coach/workspace-changed'"), 'workspace changes should broadcast to renderers')
assert(maestroWindow.includes("workspace-not-directory") && maestroWindow.includes("workspace-not-found"), 'missing or moved workspaces should be detected')
assert(maestroWindow.includes('removeDefaultWorkspaceIfPathMatches'), 'missing selected workspaces should clear matching default config')

const resolveWorkspacePath = sliceBetween(maestroWindow, 'private resolveWorkspacePath(sessionKey: string, pathArg: string): WorkspacePathResolution {', '\n  private recordAgentArtifact')
assert(resolveWorkspacePath.includes('isInsideRoot(root, target)'), 'workspace path resolution should reject paths outside root')
assert(resolveWorkspacePath.includes('realpathSync(existing)'), 'workspace path resolution should check realpath of nearest existing ancestor')
assert(resolveWorkspacePath.includes('isInsideRoot(realRoot, realExisting)'), 'workspace path resolution should reject symlink escapes')

for (const tool of ['read_file', 'list_workspace_files', 'search_files', 'write_file', 'create_artifact', 'workspace_context']) {
  assert(maestroWindow.includes(`name: '${tool}'`), `agent should expose ${tool}`)
  assert(maestroPrompt.includes(tool), `system prompt should mention ${tool}`)
}
for (const forbidden of ["name: 'delete_file'", "name: 'rename_file'", "name: 'move_file'", "rmSync(", 'unlinkSync(', 'renameSync(']) {
  assert(!maestroWindow.includes(forbidden), `workspace agent tools must not expose or call destructive operation: ${forbidden}`)
}
assert(maestroWindow.includes("if (resolved.path === resolved.root) return 'ERROR: write_file needs a file path under the workspace"), 'write_file should reject the workspace root')
assert(maestroWindow.includes('this.recordAgentArtifact(artifact)'), 'write_file should record created/updated files as artifacts')
assert(coachApi.includes("export interface AgentFileArtifact") && coachApi.includes("action: 'created' | 'updated'"), 'shared API should type created/updated file artifacts')

assert(messageStore.includes("xpcRenderer.subscribe('coach/workspace-changed'"), 'renderer store should subscribe to workspace broadcasts')
assert(messageStore.includes('await this.refreshDefaultWorkspace()'), 'renderer store should load the persisted default workspace on init')
assert(messageStore.includes('detail: { ...emptyDetail(), workspace: this.cloneWorkspace(this.defaultWorkspace) }'), 'new chats should inherit the default workspace')
assert(messageStore.includes('await coach.setWorkspaceDirectory({ sessionId: session.id, path: session.detail.workspace.path })'), 'renderer should refresh/validate saved workspace paths')
assert(messageStore.includes('session.detail = { ...session.detail, workspace: undefined }'), 'renderer should clear stale workspace references')
assert(!messageStore.includes('async reset(sessionId: string)'), 'removed reset conversation action should not return')
assert(messageStore.includes('assistant.files = reply.files?.map((file) => ({ ...file, kind: \'artifact\' }))'), 'agent-created files should attach to the assistant reply')
assert(messageType.includes("kind?: 'attachment' | 'artifact'"), 'chat file type should distinguish artifacts from attachments')

assert(chatPanel.includes('name="maestro__composer__workspace"'), 'composer should render a workspace chip')
assert(chatPanel.includes('@paste="onComposerPaste"'), 'composer should support pasted screenshots as path attachments')
assert(chatPanel.includes('title="Set workspace"'), 'composer should allow setting workspace')
assert(chatPanel.includes('title="Switch workspace"'), 'composer should allow switching workspace')
assert(chatPanel.includes('title="Refresh workspace"'), 'composer should allow refreshing workspace')
assert(chatPanel.includes('title="Clear workspace"'), 'composer should allow clearing workspace')
assert(chatPanel.includes('@keydown="onComposerKeydown"'), 'composer keyboard handling should stay attached')

assert(messageItem.includes('name="messageItem__artifacts"'), 'assistant messages should render file artifacts')
assert(messageItem.includes('coach.getFileStatuses({ paths })'), 'artifact rows should refresh file existence')
assert(messageItem.includes('coach.openFile({ path })'), 'artifact menu should open files in the default app')
assert(messageItem.includes('coach.showFileInFolder({ path })'), 'artifact menu should reveal files in the OS file browser')
assert(messageItem.includes('missing</span>'), 'artifact rows should show missing files')

console.log('[check-workspace-files] ok')

