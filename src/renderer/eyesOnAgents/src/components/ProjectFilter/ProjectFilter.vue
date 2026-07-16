<template>
  <div name="eyesOnAgents__projectFilter" class="project-filter">
    <a-select
      class="project-filter__select"
      size="mini"
      allow-search
      :aria-label="i18nHelper.eyesOnAgents.board.projectFilterLabel"
      :model-value="eyesOnAgentsStore.uncategorizedProjectFilterValue"
      @change="handleChange"
    >
      <a-option
        v-for="option in eyesOnAgentsStore.uncategorizedProjectOptions"
        :key="option.value"
        :value="option.value"
        :label="selectedLabel(option)"
      >
        <span class="project-filter__option" :title="option.projectRoot ?? undefined">
          <span>{{ optionLabel(option) }}</span>
          <span class="project-filter__count">{{ option.count }}</span>
        </span>
      </a-option>
    </a-select>
  </div>
</template>

<script setup lang="ts">
import type { EyesOnAgentsProjectFilterOption } from '../../services/projectFilter.service';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';

const optionLabel = (option: EyesOnAgentsProjectFilterOption): string => {
  if (option.type === 'all') return i18nHelper.eyesOnAgents.board.allProjects;
  if (option.type === 'none') return i18nHelper.eyesOnAgents.board.noProject;
  const name = option.projectName ?? '';
  return option.duplicateName && option.shortRoot ? `${name} · ${option.shortRoot}` : name;
};

const selectedLabel = (option: EyesOnAgentsProjectFilterOption): string => {
  return `${optionLabel(option)} (${option.count})`;
};

const handleChange = (value: unknown): void => {
  if (typeof value !== 'string') return;
  eyesOnAgentsStore.selectUncategorizedProjectFilter(value);
};
</script>

<style lang="less">
@import './ProjectFilter.less';
</style>
