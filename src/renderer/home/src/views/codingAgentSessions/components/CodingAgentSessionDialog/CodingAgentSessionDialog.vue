<template>
  <a-modal
    :visible="store.dialogMode !== null"
    :title="dialogTitle"
    :width="520"
    :mask-closable="!store.dialogSubmitting"
    :esc-to-close="!store.dialogSubmitting"
    :closable="true"
    :footer="false"
    unmount-on-close
    @cancel="store.closeDialog()"
  >
    <form
      name="codingAgentSessions__dialog"
      class="coding-agent-session-dialog"
      @submit.prevent="submit"
    >
      <template v-if="store.dialogMode === 'add'">
        <div class="coding-agent-session-dialog__grid">
          <label class="coding-agent-session-dialog__field">
            <span>{{ i18nHelper.codingAgentSessions.labels.provider }}</span>
            <a-select
              :model-value="store.registrationForm.provider"
              size="mini"
              @change="onProviderChange"
            >
              <a-option value="codex">{{
                i18nHelper.codingAgentSessions.providers.codex
              }}</a-option>
              <a-option value="claude">{{
                i18nHelper.codingAgentSessions.providers.claude
              }}</a-option>
            </a-select>
          </label>

          <label class="coding-agent-session-dialog__field">
            <span>{{ i18nHelper.codingAgentSessions.labels.surface }}</span>
            <a-select v-model="store.registrationForm.surface" size="mini">
              <a-option v-for="surface in store.availableSurfaces" :key="surface" :value="surface">
                {{ surfaceLabel(surface) }}
              </a-option>
            </a-select>
            <small v-if="fieldError('surface')" class="coding-agent-session-dialog__error">
              {{ fieldError('surface') }}
            </small>
          </label>
        </div>

        <label class="coding-agent-session-dialog__field">
          <span>{{ i18nHelper.codingAgentSessions.labels.sessionId }}</span>
          <a-input
            v-model="store.registrationForm.externalSessionId"
            size="mini"
            :placeholder="i18nHelper.codingAgentSessions.dialog.sessionIdPlaceholder"
            :error="Boolean(store.registrationErrors.externalSessionId)"
            autofocus
          />
          <small v-if="fieldError('externalSessionId')" class="coding-agent-session-dialog__error">
            {{ fieldError('externalSessionId') }}
          </small>
        </label>

        <label class="coding-agent-session-dialog__field">
          <span>
            {{ i18nHelper.codingAgentSessions.labels.title }}
            <em>{{ i18nHelper.codingAgentSessions.labels.optional }}</em>
          </span>
          <a-input
            v-model="store.registrationForm.title"
            size="mini"
            :placeholder="i18nHelper.codingAgentSessions.dialog.titlePlaceholder"
            :error="Boolean(store.registrationErrors.title)"
          />
          <small v-if="fieldError('title')" class="coding-agent-session-dialog__error">
            {{ fieldError('title') }}
          </small>
        </label>

        <label class="coding-agent-session-dialog__field">
          <span>
            {{ i18nHelper.codingAgentSessions.labels.workingDirectory }}
            <em v-if="store.registrationForm.surface !== 'claude-code-cli'">
              {{ i18nHelper.codingAgentSessions.labels.optional }}
            </em>
          </span>
          <a-input
            v-model="store.registrationForm.cwd"
            size="mini"
            :placeholder="i18nHelper.codingAgentSessions.dialog.cwdPlaceholder"
            :error="Boolean(store.registrationErrors.cwd)"
          />
          <small v-if="fieldError('cwd')" class="coding-agent-session-dialog__error">
            {{ fieldError('cwd') }}
          </small>
        </label>

        <div
          v-if="store.registrationErrors.form"
          class="coding-agent-session-dialog__form-error"
          role="alert"
        >
          <IconAlertTriangle :size="15" aria-hidden="true" />
          {{ store.registrationErrors.form }}
        </div>
      </template>

      <template v-else-if="store.dialogMode === 'rename'">
        <div class="coding-agent-session-dialog__context">
          <span>{{
            store.selectedSession?.title || store.selectedSession?.externalSessionId
          }}</span>
          <code>{{ store.selectedSession?.externalSessionId }}</code>
        </div>
        <label class="coding-agent-session-dialog__field">
          <span>{{ i18nHelper.codingAgentSessions.labels.title }}</span>
          <a-input
            v-model="store.renameTitle"
            size="mini"
            :placeholder="i18nHelper.codingAgentSessions.dialog.renamePlaceholder"
            :error="Boolean(store.renameError)"
            autofocus
          />
          <small v-if="store.renameError" class="coding-agent-session-dialog__error">
            {{ validationMessage(store.renameError) }}
          </small>
        </label>
      </template>

      <template v-else-if="store.dialogMode === 'remove'">
        <div class="coding-agent-session-dialog__remove-mark" aria-hidden="true">
          <IconTrash :size="22" />
        </div>
        <p class="coding-agent-session-dialog__remove-title">
          {{ store.selectedSession?.title || store.selectedSession?.externalSessionId }}
        </p>
        <p class="coding-agent-session-dialog__remove-copy">
          {{ i18nHelper.codingAgentSessions.messages.removeBody }}
        </p>
        <div v-if="store.renameError" class="coding-agent-session-dialog__form-error" role="alert">
          <IconAlertTriangle :size="15" aria-hidden="true" />
          {{ store.renameError }}
        </div>
      </template>

      <footer class="coding-agent-session-dialog__footer">
        <a-button size="mini" :disabled="store.dialogSubmitting" @click="store.closeDialog()">
          {{ i18nHelper.codingAgentSessions.actions.cancel }}
        </a-button>
        <a-button
          html-type="submit"
          type="primary"
          size="mini"
          :status="store.dialogMode === 'remove' ? 'danger' : 'normal'"
          :loading="store.dialogSubmitting"
          :disabled="store.dialogSubmitting"
        >
          {{ submitLabel }}
        </a-button>
      </footer>
    </form>
  </a-modal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IconAlertTriangle, IconTrash } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type {
  CodingAgentProvider,
  CodingAgentSurface
} from '@shared/codingAgent/codingAgentSession.type';
import { codingAgentSessionStore as store } from '../../codingAgentSession.store';
import type { CodingAgentRegistrationField } from '../../codingAgentSession.type';

const dialogTitle = computed(() => {
  if (store.dialogMode === 'rename') return i18nHelper.codingAgentSessions.dialog.renameTitle;
  if (store.dialogMode === 'remove') return i18nHelper.codingAgentSessions.dialog.removeTitle;
  return i18nHelper.codingAgentSessions.dialog.addTitle;
});

const submitLabel = computed(() => {
  if (store.dialogMode === 'rename') return i18nHelper.codingAgentSessions.actions.save;
  if (store.dialogMode === 'remove') return i18nHelper.codingAgentSessions.actions.remove;
  return i18nHelper.codingAgentSessions.actions.add;
});

const surfaceLabels = (): Record<CodingAgentSurface, string> => ({
  'codex-desktop': i18nHelper.codingAgentSessions.surfaces.codexDesktop,
  'codex-managed-app-server': i18nHelper.codingAgentSessions.surfaces.codexManaged,
  'claude-code-background': i18nHelper.codingAgentSessions.surfaces.claudeBackground,
  'claude-code-cli': i18nHelper.codingAgentSessions.surfaces.claudeCli,
  'claude-desktop-chat': i18nHelper.codingAgentSessions.surfaces.claudeDesktopChat,
  'claude-desktop-code': i18nHelper.codingAgentSessions.surfaces.claudeDesktopCode
});

const surfaceLabel = (surface: CodingAgentSurface): string => surfaceLabels()[surface];

const validationMessage = (value: string): string => {
  if (value === 'uuid') return i18nHelper.codingAgentSessions.validation.uuid;
  if (value === 'required') return i18nHelper.codingAgentSessions.validation.required;
  if (value === 'absolute-path') return i18nHelper.codingAgentSessions.validation.absolutePath;
  if (value === 'max-length') return i18nHelper.codingAgentSessions.validation.maxLength;
  return value;
};

const fieldError = (field: CodingAgentRegistrationField): string | null => {
  const error = store.registrationErrors[field];
  return error ? validationMessage(error) : null;
};

const onProviderChange = (value: unknown): void => {
  if (value === 'codex' || value === 'claude') {
    store.setRegistrationProvider(value as CodingAgentProvider);
  }
};

const submit = async (): Promise<void> => {
  if (store.dialogMode === 'rename') await store.submitRename();
  else if (store.dialogMode === 'remove') await store.submitRemove();
  else if (store.dialogMode === 'add') await store.submitRegistration();
};
</script>

<style lang="less">
@import './CodingAgentSessionDialog.less';
</style>
