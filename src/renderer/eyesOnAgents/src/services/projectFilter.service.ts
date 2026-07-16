import type { EyesOnAgentsThread } from '@shared/eyesOnAgents/eyesOnAgents.type';

export const ALL_PROJECT_FILTER_VALUE = 'all';
export const NO_PROJECT_FILTER_VALUE = 'none';

export type EyesOnAgentsProjectFilterSelection =
  | { type: 'all' }
  | { type: 'none' }
  | {
      type: 'project';
      projectKey: string;
      projectRoot: string;
      projectName: string;
    };

export interface EyesOnAgentsProjectFilterOption {
  value: string;
  type: 'all' | 'none' | 'project';
  count: number;
  projectKey: string | null;
  projectRoot: string | null;
  projectName: string | null;
  shortRoot: string | null;
  duplicateName: boolean;
}

const projectFilterValue = (projectKey: string): string => {
  return `project:${encodeURIComponent(projectKey)}`;
};

const shortenProjectRoot = (root: string): string => {
  const normalized = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length <= 2) return normalized;
  return `…/${segments.slice(-2).join('/')}`;
};

export const buildEyesOnAgentsProjectFilterOptions = (
  threads: EyesOnAgentsThread[],
  selection: EyesOnAgentsProjectFilterSelection
): EyesOnAgentsProjectFilterOption[] => {
  const projects = new Map<string, EyesOnAgentsProjectFilterOption>();
  let noProjectCount = 0;
  for (const thread of threads) {
    if (thread.projectKey === null) {
      noProjectCount += 1;
      continue;
    }
    if (thread.projectRoot === null || thread.projectName === null) continue;
    const existing = projects.get(thread.projectKey);
    if (existing) {
      existing.count += 1;
      continue;
    }
    projects.set(thread.projectKey, {
      value: projectFilterValue(thread.projectKey),
      type: 'project',
      count: 1,
      projectKey: thread.projectKey,
      projectRoot: thread.projectRoot,
      projectName: thread.projectName,
      shortRoot: shortenProjectRoot(thread.projectRoot),
      duplicateName: false
    });
  }
  if (selection.type === 'project' && !projects.has(selection.projectKey)) {
    projects.set(selection.projectKey, {
      value: projectFilterValue(selection.projectKey),
      type: 'project',
      count: 0,
      projectKey: selection.projectKey,
      projectRoot: selection.projectRoot,
      projectName: selection.projectName,
      shortRoot: shortenProjectRoot(selection.projectRoot),
      duplicateName: false
    });
  }

  const nameCounts = new Map<string, number>();
  for (const option of projects.values()) {
    const name = option.projectName?.toLocaleLowerCase() ?? '';
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  const projectOptions = [...projects.values()]
    .map((option) => ({
      ...option,
      duplicateName: (nameCounts.get(option.projectName?.toLocaleLowerCase() ?? '') ?? 0) > 1
    }))
    .sort((left, right) => {
      const nameOrder = (left.projectName ?? '').localeCompare(right.projectName ?? '');
      if (nameOrder !== 0) return nameOrder;
      return (left.projectRoot ?? '').localeCompare(right.projectRoot ?? '');
    });

  return [
    {
      value: ALL_PROJECT_FILTER_VALUE,
      type: 'all',
      count: threads.length,
      projectKey: null,
      projectRoot: null,
      projectName: null,
      shortRoot: null,
      duplicateName: false
    },
    {
      value: NO_PROJECT_FILTER_VALUE,
      type: 'none',
      count: noProjectCount,
      projectKey: null,
      projectRoot: null,
      projectName: null,
      shortRoot: null,
      duplicateName: false
    },
    ...projectOptions
  ];
};

export const filterEyesOnAgentsThreadsByProject = (
  threads: EyesOnAgentsThread[],
  selection: EyesOnAgentsProjectFilterSelection
): EyesOnAgentsThread[] => {
  if (selection.type === 'all') return threads;
  if (selection.type === 'none') return threads.filter((thread) => thread.projectKey === null);
  return threads.filter((thread) => thread.projectKey === selection.projectKey);
};
