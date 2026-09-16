<template>
  <div name="skills__creation-scope" class="skill-scope-control">
    <p v-if="store.skillScopeError" role="alert" class="skill-scope-control__error">{{ store.skillScopeError }}</p>
    <label class="skill-scope-control__label">{{ text.target }}</label>
    <Select v-model="store.skillImportScope" size="mini" :aria-label="text.target" class="skill-scope-control__select">
      <Option value="shared">{{ text.shared }}</Option>
      <Option value="institution" :disabled="!store.skillInstitution">{{ text.institution }}{{ store.skillInstitution ? ' · ' + (store.skillInstitution.institutionName || store.skillInstitution.institutionId) : '' }}</Option>
    </Select>
    <span class="skill-scope-control__hint">{{ store.skillImportScope === 'shared' ? text.sharedHint : store.skillInstitution?.institutionId || text.noInstitution }}</span>
  </div>
</template>
<script setup lang="ts">
import { Select, Option } from '@arco-design/web-vue'
import { workbenchStore as store } from '../workbench.store'
import { computed, unref } from 'vue'
import { i18n } from '@renderer/common/i18n/i18n.helper'
import { skillScopeEn, skillScopeZh } from '../skillScope.messages'
const text = computed(() => String(unref(i18n.global.locale)).startsWith('zh') ? skillScopeZh : skillScopeEn)
</script>
<style lang="less">
@import './SkillScopeControl.less';
</style>
