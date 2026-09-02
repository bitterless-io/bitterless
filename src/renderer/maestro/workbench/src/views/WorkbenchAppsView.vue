<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button, Message } from '@arco-design/web-vue'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import { homeShellBridge } from '@renderer/common/homeShellBridge.client'
import { omniWindowEmitter } from '@/emitter/omniWindow.emitter'
import { maestroWindowEmitter } from '@/emitter/maestroWindow.emitter'
import { coinWindowEmitter } from '@/emitter/coinWindow.emitter'
import { eyesOnAgentsWindowEmitter } from '@/emitter/eyesOnAgentsWindow.emitter'
import { submodulesWindowEmitter } from '@/emitter/submodulesWindow.emitter'
import { onlyPreviewEmitter } from '@/emitter/onlyPreview.emitter'
import { unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract'
import { createMiniApps, type MiniApp } from '@/views/miniApp/miniApps.constant'
import './WorkbenchAppsView.less'

const openingAppIds = ref(new Set<string>())

const miniApps = computed(() =>
  createMiniApps(
    async () => {
      // Home owns the authenticated customer token and Todo readiness handshake. Keep that
      // authority in its hidden login shell instead of copying auth state into Maestro's partition.
      await homeShellBridge.openTodo()
    },
    async () => await maestroWindowEmitter.openMaestroWindow(),
    async () => await coinWindowEmitter.openCoinWindow(),
    async () => await eyesOnAgentsWindowEmitter.openEyesOnAgentsWindow(),
    async () => {
      const result = await omniWindowEmitter.openOmniWindow()
      if (!result?.opened) throw new Error('Omni Browser did not become ready')
      Message.success(
        i18nHelper.miniApp.opened.replace('{name}', i18nHelper.miniApp.omniBrowser.name),
      )
    },
    async () => unwrapOnlyPreviewResult(await onlyPreviewEmitter.openOnlyPreviewWindow()),
    async () => await submodulesWindowEmitter.openSubmodulesWindow(),
    i18nHelper,
  ),
)

const openApp = async (app: MiniApp): Promise<void> => {
  if (openingAppIds.value.has(app.id)) return
  openingAppIds.value.add(app.id)
  try {
    await app.action()
  } catch (err) {
    console.error(`[WorkbenchApps] Failed to open ${app.id}:`, err)
    Message.error(i18nHelper.miniApp.openFailed.replace('{name}', app.name))
  } finally {
    openingAppIds.value.delete(app.id)
  }
}
</script>

<template>
  <section name="workbench-apps" class="workbench-apps">
    <div name="workbench-apps__grid" class="workbench-apps__grid">
      <article
        v-for="app in miniApps"
        :key="app.id"
        name="workbench-apps__item"
        class="workbench-apps__item"
      >
        <img :src="app.icon" :alt="app.name" class="workbench-apps__icon" />
        <div class="workbench-apps__identity">
          <strong>{{ app.name }}</strong>
          <p>{{ app.subtitle }}</p>
        </div>
        <Button
          name="workbench-apps__item__open"
          class="workbench-apps__open"
          size="small"
          type="primary"
          :loading="openingAppIds.has(app.id)"
          :disabled="openingAppIds.has(app.id)"
          @click="openApp(app)"
        >
          {{ i18nHelper.miniApp.open }}
        </Button>
      </article>
    </div>
  </section>
</template>
