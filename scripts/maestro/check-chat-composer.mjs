import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src')
const chatPanel = readFileSync(join(root, 'renderer/maestro/control/src/ChatPanel.vue'), 'utf8')
const chatPanelLess = readFileSync(join(root, 'renderer/maestro/control/src/ChatPanel.less'), 'utf8')
const mcpGuide = readFileSync(join(root, 'renderer/todo/src/components/McpGuideModal/McpGuideModal.vue'), 'utf8')
const mcpGuideLess = readFileSync(join(root, 'renderer/todo/src/components/McpGuideModal/McpGuideModal.less'), 'utf8')
const rendererEn = readFileSync(join(root, 'renderer/common/i18n/en.ts'), 'utf8')
const rendererZh = readFileSync(join(root, 'renderer/common/i18n/zh.ts'), 'utf8')
const sharedIconBtn = readFileSync(join(root, 'renderer/common/components/IconBtn/IconBtn.vue'), 'utf8')
const sharedIconBtnLess = readFileSync(join(root, 'renderer/common/components/IconBtn/IconBtn.less'), 'utf8')
const legacyIconBtnPath = join(root, 'renderer/maestro/common/components/IconBtn.vue')
const controlApp = readFileSync(join(root, 'renderer/maestro/control/src/ControlApp.vue'), 'utf8')
const messageStore = readFileSync(join(root, 'renderer/maestro/control/src/store/message.store.ts'), 'utf8')
const maestroWindow = readFileSync(join(root, 'main/maestro/windows/main/maestroWindow.controller.ts'), 'utf8')
const maestroAgent = readFileSync(join(root, 'main/maestro/agent/maestroAgent.service.ts'), 'utf8')
const agentPrompt = readFileSync(join(root, 'main/maestro/agent/runtime/agentPrompt.ts'), 'utf8')
const aiCrmsCoreUpload = readFileSync(join(root, 'main/maestro/networking/api/aiCrmsCoreFileUpload.api.ts'), 'utf8')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const chatTemplate = chatPanel.match(/<template>([\s\S]*?)<\/template>\s*$/)?.[1] || ''
const chatPanelBemClass = /^chat-panel(?:__[a-z0-9]+(?:-[a-z0-9]+)*(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?)?$/
const assertBemTokens = (value, context) => {
  for (const token of value.trim().split(/\s+/).filter(Boolean)) {
    assert(chatPanelBemClass.test(token), `${context} should use only chat-panel BEM classes: ${token}`)
  }
}

assert(chatTemplate, 'ChatPanel should expose one root template')
for (const match of chatTemplate.matchAll(/(?<!:)class="([^"]*)"/g)) {
  assertBemTokens(match[1], 'ChatPanel static class')
}
for (const match of chatTemplate.matchAll(/:class="([^"]*)"/g)) {
  for (const classValue of match[1].matchAll(/['`]([^'`]+)['`]/g)) {
    assertBemTokens(classValue[1], 'ChatPanel dynamic class')
  }
}

assert(chatPanel.includes("import IconBtn from '../../../common/components/IconBtn/IconBtn.vue'"), 'ChatPanel should use the renderer-shared IconBtn without crossing the Maestro alias boundary')
assert(chatPanel.includes("import './ChatPanel.less'"), 'ChatPanel should import its sibling Less stylesheet')
assert(chatPanel.includes("import { Button, Drawer, Message, Modal, Tooltip } from '@arco-design/web-vue'"), 'ChatPanel should use Arco Button for text and status actions')
assert(!chatTemplate.includes('<button'), 'ChatPanel should not retain raw button controls')
assert(!chatPanel.includes('<style'), 'ChatPanel voice and layout styles should live in ChatPanel.less')
assert(chatPanelLess.includes('.chat-panel {'), 'ChatPanel Less should own the chat-panel BEM block')
assert(chatPanelLess.includes('.chat-panel__voice-wave-bar'), 'ChatPanel Less should own voice wave styling')
assert(chatPanelLess.includes('padding-right: 132px'), 'recording state should retain textarea space for the timer')
assert(chatPanelLess.includes('container-type: inline-size'), 'ChatPanel responsive controls should follow the panel width')
assert(chatPanelLess.includes('@container (max-width: 480px)'), 'narrow ChatPanel actions should wrap without relying on viewport width')
assert(chatPanelLess.includes('.chat-panel .chat-panel__send-button.icon-btn.arco-btn') && chatPanelLess.includes('background: #4e5882'), 'send IconBtn should retain the Royal Blue action treatment over Arco defaults')
assert(!existsSync(legacyIconBtnPath), 'Maestro-local Tailwind IconBtn should be removed')

assert(sharedIconBtn.includes("import { Button } from '@arco-design/web-vue'"), 'shared IconBtn should wrap Arco Button')
assert(sharedIconBtn.includes("import './IconBtn.less'"), 'shared IconBtn should import sibling Less')
assert(sharedIconBtn.includes('type="text"') && !sharedIconBtn.includes('shape="circle"'), 'shared IconBtn should keep the existing rounded-square Arco text action shape')
assert(sharedIconBtn.includes('<template #icon>'), 'shared IconBtn should render its slot through Arco only-icon markup')
assert(sharedIconBtn.includes('v-bind="$attrs"'), 'shared IconBtn should preserve ordinary attributes and events')
assert(sharedIconBtnLess.includes('.icon-btn.arco-btn'), 'shared IconBtn should use its BEM Less block')
assert(sharedIconBtnLess.includes('border-radius: 6px'), 'shared IconBtn should keep the existing rounded-square shape')
assert(!sharedIconBtn.includes('tailwind') && !sharedIconBtnLess.includes('@apply'), 'shared IconBtn should not depend on Tailwind utilities')

assert(mcpGuide.includes('<template #title>'), 'MCP guide should use the native Arco title slot')
assert(mcpGuide.includes('title-align="start"'), 'MCP guide should align its Arco title at the start')
assert(!mcpGuide.includes('IconX') && !mcpGuide.includes('mcp-guide__header'), 'MCP guide should rely on the native Arco close control')
const mcpTemplate = mcpGuide.match(/<template>([\s\S]*?)<script setup/)?.[1] || ''
const mcpGuideBemClass = /^(?:mcp-guide-modal|mcp-guide(?:__[a-z0-9]+(?:-[a-z0-9]+)*){0,2}(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?)$/
for (const match of mcpTemplate.matchAll(/(?<!:)class="([^"]*)"/g)) {
  for (const token of match[1].trim().split(/\s+/).filter(Boolean)) {
    assert(mcpGuideBemClass.test(token), `MCP guide should use only shallow business BEM classes: ${token}`)
  }
}
assert((mcpGuide.match(/<IconBtn\b/g) || []).length === 4, 'all four MCP and skill copy actions should use shared IconBtn')
assert((mcpGuide.match(/<IconCopy\b/g) || []).length === 4, 'all four MCP and skill copy actions should use Tabler IconCopy')
for (const value of ['commandPath', 'configJson', 'skillPath', 'instruction']) {
  if (value === 'skillPath') {
    assert(mcpGuide.includes(':disabled="skillState.status !== \'ready\'"'), 'MCP skillPath copy action should require a current integration contract')
  } else if (value === 'instruction') {
    assert(mcpGuide.includes(':disabled="skillState.status !== \'ready\' || !instruction"'), 'MCP instruction copy action should require a current integration contract')
  } else {
    assert(mcpGuide.includes(`:disabled="!${value}"`), `MCP ${value} copy action should be disabled while empty`)
  }
}
for (const tag of mcpGuide.match(/<IconBtn\b[\s\S]*?>/g) || []) {
  assert(tag.includes(':title=') && tag.includes(':aria-label='), 'MCP copy IconBtn should have an accessible title and label')
}
assert(mcpGuideLess.includes('width: calc(100vw - 32px) !important'), 'MCP modal should stay within the Todo viewport')
assert(mcpGuideLess.includes('max-height: calc(100vh - 106px)'), 'MCP modal body should scroll within the viewport')
assert(mcpGuide.includes('mcpStepConnect') && mcpGuide.includes('mcpStepSkill'), 'MCP guide should present MCP and skill as two labeled steps')
assert(mcpGuide.includes('<a-alert') && mcpGuide.includes('type="warning"') && mcpGuide.includes('show-icon'), 'non-production MCP safety should use a prominent Arco warning')
assert(mcpGuide.includes("v-if=\"info && info.serverName !== 'bitterless'\""), 'MCP safety warning should render only for non-production server names')
assert(mcpGuide.includes("mcpTestInstanceTitle.replace('{serverName}', info.serverName)"), 'MCP safety warning should visibly identify the current test server name')
assert(mcpGuide.includes('mcpTestInstanceWarning'), 'MCP safety warning should visibly direct real personal Todo work to production')
assert(rendererEn.includes("mcpTestInstanceTitle: 'Test-only MCP: {serverName}'") && rendererEn.includes('Do not store real personal todos in this instance') && rendererEn.includes('production bitterless server'), 'English MCP warning should identify the test server and direct real personal Todo work to production')
assert(rendererZh.includes("mcpTestInstanceTitle: '仅限测试的 MCP：{serverName}'") && rendererZh.includes('不要在当前实例保存真实个人待办') && rendererZh.includes('生产 server bitterless'), 'Chinese MCP warning should identify the test server and direct real personal Todo work to production')
assert(mcpGuide.includes('mcpCompleteSetup') && mcpGuide.includes('@click="copyCompleteSetup"'), 'MCP guide should copy complete MCP and skill setup instructions')
assert(mcpGuide.includes('copyText(skillPath)'), 'MCP guide should expose a copy action for the bundled skill directory')
assert(mcpGuide.includes("skillState.status === 'restart-required'") && mcpGuide.includes('mcpRestartRequiredDescription'), 'a stale main-process response should surface a restart-required contract error')
assert(!/info\?\.[a-zA-Z]+ \|\| i18nHelper\.todo\.mcpLoading/.test(mcpGuide), 'Loading should render only while integration info is genuinely pending')
assert(!mcpGuide.includes('class="flex') && !mcpGuideLess.includes('@apply'), 'MCP guide should remain business BEM and Less without Tailwind utilities')

assert(chatPanel.includes('function onComposerKeydown(event: KeyboardEvent): void'), 'composer keydown handler should exist')
assert(
  chatPanel.includes("if (event.key !== 'Enter' || event.shiftKey) return"),
  'Enter should send while Shift+Enter remains a newline'
)
assert(chatPanel.includes('event.preventDefault()'), 'Enter send should prevent textarea newline insertion')
assert(chatPanel.includes('void send()'), 'Enter handler should call send')
assert(chatPanel.includes('@keydown="onComposerKeydown"'), 'textarea should use the composer keydown handler')
assert(chatPanel.includes('@paste="onComposerPaste"'), 'textarea should materialize pasted screenshots')
assert(chatPanel.includes('coach.attachClipboardImage({ sessionId: props.session.id })'), 'pasted screenshots should be registered by main without renderer bytes')
assert(!chatPanel.includes('FileReader'), 'renderer should not read pasted image bytes')
assert(!chatPanel.includes('readAsDataURL'), 'renderer should not convert pasted images to data URLs')
assert(!chatPanel.includes('arrayBuffer()'), 'renderer should not send pasted image ArrayBuffers')
assert(!chatPanel.includes('data:image'), 'renderer should not inline pasted images as base64 data URLs')
assert(maestroWindow.includes('return await this.agentService.attachClipboardImage(params)'), 'controller should expose clipboard screenshot materialization')
assert(maestroAgent.includes('async attachClipboardImage'), 'AgentService should own clipboard screenshot materialization')
assert(maestroAgent.includes('clipboard.readImage()'), 'AgentService should read clipboard images from Electron')
assert(maestroAgent.includes('const png = image.toPNG()'), 'AgentService may use PNG bytes only as a local write buffer')
assert(maestroAgent.includes("join(maestroDataRoot(), 'attachments', safeKey)"), 'clipboard screenshots should be stored under the isolated Maestro data root')
assert(maestroAgent.includes('writeFileSync(file, png)'), 'AgentService should write clipboard PNG bytes to disk')
assert(maestroAgent.includes('paths: [file]'), 'clipboard screenshots should re-enter chat as path attachments')
assert(!messageStore.includes('base64') && !messageStore.includes('data:image'), 'chat messages should not persist inline image payloads')
assert(!chatPanel.includes('title="Reset conversation"'), 'reset conversation button should be removed')
assert(!chatPanel.includes('@click="resetConversation"'), 'composer should not call resetConversation')
assert(!chatPanel.includes('function resetConversation'), 'resetConversation handler should be removed')
assert(!messageStore.includes('async reset(sessionId: string)'), 'messageStore should not expose the removed reset action')
assert(!messageStore.includes('await coach.resetAgentConversation({ sessionId: session.id })'), 'renderer should not reset the host agent session from composer')
assert(chatPanel.includes('await appendTranscript(result.text)'), 'voice scribe should insert the transcript into the composer input')
assert(chatPanel.includes('IconPlayerPause v-else-if="voiceRecording"'), 'voice button should show a pause icon while recording')
assert(chatPanel.includes('IconLoader2 v-if="voiceBusy"'), 'voice button should show loading while audio is uploading/transcribing')
assert(chatPanel.includes('const VOICE_SCRIBE_SAMPLE_RATE = 16_000'), 'voice scribe should downsample recordings to 16k before upload')
assert(chatPanel.includes('const VOICE_SCRIBE_MAX_MS = 5 * 60 * 1000'), 'voice scribe should cap Flash ASR recordings at 5 minutes')
assert(chatPanel.includes('resamplePcm(concatPcmChunks(chunks)'), 'voice scribe should resample raw microphone PCM before WAV encoding')
assert(chatPanel.includes('void stopVoiceScribe(true)'), 'voice scribe should auto-stop at the Flash ASR duration limit')
assert(chatPanel.includes('sampleRate: wav.sampleRate'), 'voice scribe should send the resampled WAV rate to ASR')
assert(maestroWindow.includes('return await this.agentService.scribeAudio(params)'), 'controller should expose the ASR facade')
assert(maestroAgent.includes("transport: 'core-sts-private-url'"), 'AI-CRMS ASR should use core STS private URL transport')
assert(agentPrompt.includes('export const MAX_ASR_AUDIO_BYTES = 16 * 1024 * 1024'), 'agent runtime should allow a 5-minute 16k WAV while keeping an ASR file-size guard')
assert(maestroAgent.includes('uploadFileThroughAiCrmsCore({'), 'AI-CRMS ASR should upload audio through core before calling Bailian')
assert(maestroAgent.includes('bailianMultimodalGenerationUrl(endpoint.baseUrl)'), 'Fun-ASR-Flash should call the DashScope multimodal generation relay route')
assert(maestroAgent.includes('input: {') && maestroAgent.includes('parameters') && maestroAgent.includes('sample_rate'), 'Fun-ASR-Flash request should use DashScope input/parameters body shape')
assert(maestroAgent.includes('input_audio:') && maestroAgent.includes('data: audioUrl'), 'AI-CRMS ASR should send the uploaded audio URL to Bailian')
assert(agentPrompt.includes('record.output?.text') && agentPrompt.includes('record.text'), 'AI-CRMS ASR should parse Fun-ASR-Flash text fields')
assert(agentPrompt.includes('record.output?.choices?.[0]?.message?.content'), 'AI-CRMS ASR should parse DashScope generation output choices')
assert(!maestroAgent.includes("audio.toString('base64')"), 'AI-CRMS ASR should not inline audio as base64')
assert(controlApp.includes('formatDebugDetail') && controlApp.includes('JSON.stringify(detail, null, 2)'), 'debug logs should stringify object details')
assert(aiCrmsCoreUpload.includes("'/share/file/get-upload-url'"), 'core upload should request a presigned upload URL')
assert(aiCrmsCoreUpload.includes("method: 'PUT'") && aiCrmsCoreUpload.includes('ticket.upload_url'), 'core upload should PUT the audio to the returned OSS URL')
assert(aiCrmsCoreUpload.includes("'/share/file/complete-upload'"), 'core upload should mark upload completion')
assert(aiCrmsCoreUpload.includes("'/share/file/file-url'"), 'core upload should request a downloadable/signed file URL for Bailian')

console.log('[check-chat-composer] ok')
