import { reactive } from 'vue';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { domainEmitter } from '../emitter/domain.emitter';
import { todoEmitter } from '../emitter/todo.emitter';
import { subTodoEmitter } from '../emitter/subTodo.emitter';
import { Message } from '@arco-design/web-vue';
import { playSuccessSound } from '@renderer/common/utils/sound.util';
import { todoSettingStore } from './todoSetting.store';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import {
  hasNumberFields,
  hasStringFields,
  isNullableNumber,
  isRecord,
  requireArray,
  requireOptionalItem,
  requireRecordMap,
  requireStringArray,
  requireVoidResult,
  type UnknownRecord,
} from './todoResult.guard';

export interface DomainItem {
  id: string;
  customer_id: string;
  title: string;
  description: string;
  is_deleted: number;
  archived: number;
  position: number;
  created_at: number;
  updated_at: number;
}

export type TodoSource = 'human' | 'ai';

export interface TodoItem {
  id: string;
  customer_id: string;
  domain_id: string;
  title: string;
  status: number;
  important: number;
  due_at: number | null;
  repeat_type: string | null;
  repeat_interval: number;
  remind_at: number | null;
  last_remind_at: number | null;
  last_complete_at: number | null;
  week_day: number | null;
  monthly_day: number | null;
  yearly_day: number | null;
  note: string;
  source: TodoSource;
  is_deleted: number;
  position: number;
  created_at: number;
  updated_at: number;
}

export interface SubTodoItem {
  id: string;
  customer_id: string;
  todo_id: string;
  title: string;
  status: number;
  is_deleted: number;
  position: number;
  created_at: number;
  updated_at: number;
}

const isDomainItem = (value: unknown): value is DomainItem => {
  if (!isRecord(value)) return false;
  return hasStringFields(value, ['id', 'customer_id', 'title', 'description']) && hasNumberFields(value, [
    'is_deleted', 'archived', 'position', 'created_at', 'updated_at',
  ]);
};

const isTodoItem = (value: unknown): value is TodoItem => {
  if (!isRecord(value)) return false;
  return hasStringFields(value, ['id', 'customer_id', 'domain_id', 'title', 'note', 'source']) &&
    hasNumberFields(value, [
      'status', 'important', 'repeat_interval', 'is_deleted', 'position', 'created_at', 'updated_at',
    ]) &&
    [
      'due_at', 'remind_at', 'last_remind_at', 'last_complete_at', 'week_day', 'monthly_day',
      'yearly_day',
    ].every((field) => isNullableNumber(value[field])) &&
    (value.repeat_type === null || typeof value.repeat_type === 'string') &&
    (value.source === 'human' || value.source === 'ai');
};

const isSubTodoItem = (value: unknown): value is SubTodoItem => {
  if (!isRecord(value)) return false;
  return hasStringFields(value, ['id', 'customer_id', 'todo_id', 'title']) && hasNumberFields(value, [
    'status', 'is_deleted', 'position', 'created_at', 'updated_at',
  ]);
};

const isSubTodoCount = (value: unknown): value is { total: number; done: number } => (
  isRecord(value) &&
  Number.isSafeInteger(value.total) &&
  Number.isSafeInteger(value.done) &&
  (value.total as number) >= 0 &&
  (value.done as number) >= 0
);

const requireSubTodoCounts = (
  value: unknown,
  todoIds: readonly string[],
  label: string,
): Record<string, { total: number; done: number }> => {
  return requireRecordMap(value, todoIds, label, isSubTodoCount);
};

const toInlineMarkdownText = (value: string): string => {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ');
};

const toBlockMarkdownText = (value: string): string => {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
};

class TodoState {
  loading = false;
  currentTime: Dayjs = dayjs();
  private _timerStarted = false;

  constructor() {
    // this.startCurrentTimeLoop();
  }

  startCurrentTimeLoop(): void {
    if (this._timerStarted) return;
    this._timerStarted = true;
    setInterval(() => {
      this.currentTime = dayjs();
    }, 1000);
  }
  domainList: DomainItem[] = [];
  archivedDomainList: DomainItem[] = [];
  todosByDomain: Record<string, TodoItem[]> = {};
  completedTodosByDomain: Record<string, TodoItem[]> = {};
  selectedTodo: TodoItem | null = null;
  subTodos: SubTodoItem[] = [];
  subTodoCounts: Record<string, { total: number; done: number }> = {};
  detailVisible = false;
  newlyCreatedTodoId: string | null = null;

  async loadAll(): Promise<void> {
    this.loading = true;
    try {
      const allDomains = requireArray(await domainEmitter.getAll(), 'domain list', isDomainItem);
      const domains = allDomains.filter((domain) => domain.is_deleted === 0 && domain.archived === 0);
      this.archivedDomainList = allDomains
        .filter((domain) => domain.is_deleted === 0 && domain.archived === 1)
        .sort((a, b) => b.updated_at - a.updated_at);
      const domainOrder = requireStringArray(
        await todoEmitter.getSortOrder({ key: 'domain' }),
        'domain sort order',
      );

      // Sort domains by sort order, unordered ones at end by created_at ASC
      if (domainOrder.length > 0) {
        const orderMap = new Map<string, number>();
        for (let i = 0; i < domainOrder.length; i++) {
          orderMap.set(domainOrder[i], i);
        }
        domains.sort((a, b) => {
          const aIdx = orderMap.get(a.id);
          const bIdx = orderMap.get(b.id);
          if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
          if (aIdx !== undefined) return -1;
          if (bIdx !== undefined) return 1;
          return a.created_at - b.created_at;
        });
      }

      this.domainList = domains;
      this.todosByDomain = {};
      this.completedTodosByDomain = {};
      this.subTodoCounts = {};
      const activeDomainIds = new Set(domains.map((domain) => domain.id));
      if (this.selectedTodo && !activeDomainIds.has(this.selectedTodo.domain_id)) {
        this.closeDetail();
      }

      // Load todos for each domain
      for (const domain of domains) {
        await this.loadTodosForDomain(domain.id);
      }
    } finally {
      this.loading = false;
    }
  }

  async loadArchivedDomains(): Promise<void> {
    const domains = requireArray(await domainEmitter.getAll(), 'archived domain list', isDomainItem);
    this.archivedDomainList = domains
      .filter((domain) => domain.is_deleted === 0 && domain.archived === 1)
      .sort((a, b) => b.updated_at - a.updated_at);
  }

  async loadTodosForDomain(domainId: string): Promise<void> {
    const statusFilter = todoSettingStore.showCompleted ? undefined : 0;
    const todos = requireArray(
      await todoEmitter.getByDomainId({ domainId, status: statusFilter }),
      'Todo list',
      isTodoItem,
    );
    const sortKey = `todo__${domainId}`;
    const sortOrder = requireStringArray(
      await todoEmitter.getSortOrder({ key: sortKey }),
      'Todo sort order',
    );

    const sortFn = (a: TodoItem, b: TodoItem) => {
      if (sortOrder.length > 0) {
        const orderMap = new Map<string, number>();
        for (let i = 0; i < sortOrder.length; i++) {
          orderMap.set(sortOrder[i], i);
        }
        const aIdx = orderMap.get(a.id);
        const bIdx = orderMap.get(b.id);
        if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
        if (aIdx !== undefined) return -1;
        if (bIdx !== undefined) return 1;
      }
      return b.created_at - a.created_at;
    };

    if (todoSettingStore.showCompleted) {
      const uncompleted = todos.filter((t) => t.status === 0);
      const completed = todos.filter((t) => t.status === 1);
      uncompleted.sort(sortFn);
      completed.sort((a, b) => b.updated_at - a.updated_at);
      this.todosByDomain[domainId] = uncompleted;
      this.completedTodosByDomain[domainId] = completed;
    } else {
      todos.sort(sortFn);
      this.todosByDomain[domainId] = todos;
      this.completedTodosByDomain[domainId] = [];
    }

    // Batch load sub-todo counts
    const todoIds = todos.map((t) => t.id);
    if (todoIds.length > 0) {
      const countsMap = requireSubTodoCounts(
        await subTodoEmitter.getCountsByTodoIds({ todoIds }),
        todoIds,
        'SubTodo count map',
      );
      for (const todo of todos) {
        this.subTodoCounts[todo.id] = countsMap[todo.id];
      }
    }
  }

  get focusedTodoList(): TodoItem[] {
    const todayStart = dayjs().startOf('day').valueOf();
    const todayEnd = dayjs().endOf('day').valueOf();
    const filters = todoSettingStore.focusedFilters;
    const result: TodoItem[] = [];
    for (const domainId in this.todosByDomain) {
      const list = this.todosByDomain[domainId];
      for (const todo of list) {
        if (todo.status !== 0) continue;
        const isImportant = filters.important && todo.important === 1;
        const isOverdue = filters.overdue && todo.due_at !== null && todo.due_at < todayStart;
        const isDueToday = filters.today && todo.due_at !== null && todo.due_at >= todayStart && todo.due_at <= todayEnd;
        if (isImportant || isOverdue || isDueToday) {
          result.push(todo);
        }
      }
    }
    result.sort((a, b) => {
      if (a.important !== b.important) return b.important - a.important;
      const aHasDue = a.due_at !== null ? 1 : 0;
      const bHasDue = b.due_at !== null ? 1 : 0;
      if (aHasDue !== bHasDue) return bHasDue - aHasDue;
      if (a.due_at !== null && b.due_at !== null) return a.due_at - b.due_at;
      return b.created_at - a.created_at;
    });
    return result;
  }

  async createDomain(title?: string): Promise<void> {
    if (this.domainList.length >= 17) {
      Message.warning(i18nHelper.todo.domainLimitReached);
      return;
    }
    const domain = requireOptionalItem(
      await domainEmitter.create({ title: title ?? 'Untitled' }),
      'Domain create',
      isDomainItem,
    );
    if (domain === undefined) {
      Message.warning(i18nHelper.todo.domainLimitReached);
      return;
    }
    this.domainList.push(domain);
    this.todosByDomain[domain.id] = [];
  }

  async updateDomainTitle(id: string, title: string): Promise<void> {
    requireVoidResult(
      await domainEmitter.updateTitle({ id, title }),
      'Domain title update',
    );
    const domain = this.domainList.find((d) => d.id === id);
    if (domain) {
      domain.title = title;
    }
  }

  async updateDomainDescription(id: string, description: string): Promise<void> {
    requireVoidResult(
      await domainEmitter.updateDescription({ id, description }),
      'Domain description update',
    );
    const domain = this.domainList.find((d) => d.id === id);
    if (domain) {
      domain.description = description;
    }
  }

  async deleteDomain(id: string): Promise<void> {
    requireVoidResult(await domainEmitter.hardDelete({ id }), 'Domain delete');
    await this._writeSortOrder(id, []);
    this.domainList = this.domainList.filter((d) => d.id !== id);
    delete this.todosByDomain[id];
    delete this.completedTodosByDomain[id];
  }

  async archiveDomain(id: string): Promise<void> {
    requireVoidResult(
      await domainEmitter.setArchived({ id, archived: 1 }),
      'Domain archive',
    );
    const domain = this.domainList.find((d) => d.id === id);
    if (domain) {
      domain.archived = 1;
      domain.updated_at = Date.now();
      this.archivedDomainList.unshift(domain);
    }
    this.domainList = this.domainList.filter((d) => d.id !== id);
    delete this.todosByDomain[id];
    delete this.completedTodosByDomain[id];
    if (this.selectedTodo?.domain_id === id) {
      this.closeDetail();
    }
  }

  async restoreDomain(id: string): Promise<boolean> {
    const archivedDomain = this.archivedDomainList.find((domain) => domain.id === id);
    const result = await domainEmitter.restore({ id });
    if (
      result !== 'restored' &&
      result !== 'already_active' &&
      result !== 'limit_reached' &&
      result !== 'not_found'
    ) {
      throw new Error('[todo] Domain restore returned an invalid required result');
    }
    if (result === 'limit_reached') {
      Message.warning(i18nHelper.todo.domainLimitReached);
      return false;
    }
    if (result === 'not_found') {
      throw new Error(`Archived domain ${id} no longer exists`);
    }

    let restoredDomain = archivedDomain
      ? { ...archivedDomain, archived: 0, updated_at: Date.now() }
      : undefined;
    restoredDomain = requireOptionalItem(
      await domainEmitter.getById({ id }),
      'restored Domain read',
      isDomainItem,
    ) ?? restoredDomain;

    this.archivedDomainList = this.archivedDomainList.filter((domain) => domain.id !== id);
    if (restoredDomain) {
      const activeIndex = this.domainList.findIndex((domain) => domain.id === id);
      if (activeIndex >= 0) {
        this.domainList[activeIndex] = restoredDomain;
      } else {
        this.domainList.push(restoredDomain);
      }
      this.todosByDomain[id] ??= [];
      this.completedTodosByDomain[id] ??= [];
      try {
        await this.loadTodosForDomain(id);
      } catch (error) {
        console.error('[todo] domain restored but its todos could not be reloaded:', error);
      }
    }
    return true;
  }

  async saveDomainOrder(order: string[]): Promise<void> {
    requireVoidResult(
      await todoEmitter.setSortOrder({ key: 'domain', order }),
      'Domain sort order update',
    );
  }

  async createTodo(domainId: string, title: string): Promise<void> {
    const activeCount = (this.todosByDomain[domainId] ?? []).length;
    if (activeCount >= 77) {
      Message.warning(i18nHelper.todo.todoLimitReached);
      return;
    }
    const todo = requireOptionalItem(
      await todoEmitter.create({ domainId, title }),
      'Todo create',
      isTodoItem,
    );
    if (todo) {
      await this._appendToSortOrder(domainId, todo.id);
      const activeList = this.todosByDomain[domainId] ?? [];
      activeList.push(todo);
      this.todosByDomain[domainId] = activeList;
      this.newlyCreatedTodoId = todo.id;
      setTimeout(() => {
        if (this.newlyCreatedTodoId === todo.id) this.newlyCreatedTodoId = null;
      }, 1500);
    }
  }

  async completeTodo(id: string): Promise<void> {
    const result = requireOptionalItem(await todoEmitter.completeTodo({ id }), 'Todo complete', isTodoItem);
    if (result) {
      playSuccessSound();
      if (result.status === 0) {
        // repeat todo: stays in active list, just update in place
        this._replaceInActiveList(result);
      } else {
        // non-repeat: remove from sort, move to completed list
        await this._removeFromSortOrder(result.domain_id, id);
        this._removeFromActiveList(result.domain_id, id);
        if (todoSettingStore.showCompleted) {
          const completedList = this.completedTodosByDomain[result.domain_id] ?? [];
          completedList.unshift(result);
          this.completedTodosByDomain[result.domain_id] = completedList;
        }
      }
      if (this.selectedTodo?.id === id) {
        this.selectedTodo = result;
      }
    }
  }

  async uncompleteTodo(id: string): Promise<void> {
    const result = requireOptionalItem(await todoEmitter.uncompleteTodo({ id }), 'Todo uncomplete', isTodoItem);
    if (result) {
      await this._appendToSortOrder(result.domain_id, id);
      this._removeFromCompletedList(result.domain_id, id);
      const activeList = this.todosByDomain[result.domain_id] ?? [];
      activeList.push(result);
      this.todosByDomain[result.domain_id] = activeList;
      if (this.selectedTodo?.id === id) {
        this.selectedTodo = result;
      }
    }
  }

  async toggleImportant(id: string): Promise<void> {
    const result = requireOptionalItem(await todoEmitter.toggleImportant({ id }), 'Todo importance', isTodoItem);
    if (result) {
      const domainId = result.domain_id;
      if (result.important === 1) {
        await this._prependToSortOrder(domainId, id);
      } else {
        // Insert after the last important=1 item in sort order
        const order = await this._readSortOrder(domainId);
        const list = this.todosByDomain[domainId] ?? [];
        const idMap = new Map<string, TodoItem>();
        for (const t of list) idMap.set(t.id, t);
        // Find the last important=1 item's id in the order (excluding current id)
        let lastImportantId: string | null = null;
        for (let i = 0; i < order.length; i++) {
          const t = idMap.get(order[i]);
          if (t && t.important === 1 && order[i] !== id) lastImportantId = order[i];
        }
        const filtered = order.filter((x) => x !== id);
        // Find insertion index in filtered array
        const insertIdx = lastImportantId !== null
          ? filtered.indexOf(lastImportantId) + 1
          : 0;
        filtered.splice(insertIdx, 0, id);
        await this._writeSortOrder(domainId, filtered);
      }
      this._replaceInActiveList(result);
      const sortOrder = await this._readSortOrder(domainId);
      this._sortActiveListByOrder(domainId, sortOrder);
      if (this.selectedTodo?.id === id) {
        this.selectedTodo = result;
      }
    }
  }

  async updateTodo(params: {
    id: string;
    title?: string;
    due_at?: number | null;
    remind_at?: number | null;
    note?: string;
    important?: number;
  }): Promise<void> {
    const result = requireOptionalItem(await todoEmitter.update(params), 'Todo update', isTodoItem);
    if (result) {
      this._replaceInActiveList(result);
      this._replaceInCompletedList(result);
      if (this.selectedTodo?.id === params.id) {
        this.selectedTodo = result;
      }
    }
  }

  async updateRepeatType(id: string, repeatType: string | null): Promise<void> {
    const result = requireOptionalItem(
      await todoEmitter.updateRepeatType({ id, repeatType }),
      'Todo repeat type update',
      isTodoItem,
    );
    if (result) {
      this._replaceInActiveList(result);
      this._replaceInCompletedList(result);
      if (this.selectedTodo?.id === id) {
        this.selectedTodo = result;
      }
    }
  }

  async updateRepeatInterval(id: string, interval: number): Promise<void> {
    const result = requireOptionalItem(
      await todoEmitter.updateRepeatInterval({ id, interval }),
      'Todo repeat interval update',
      isTodoItem,
    );
    if (result) {
      this._replaceInActiveList(result);
      this._replaceInCompletedList(result);
      if (this.selectedTodo?.id === id) {
        this.selectedTodo = result;
      }
    }
  }

  async skipToCurrent(id: string): Promise<void> {
    const result = requireOptionalItem(await todoEmitter.skipToCurrent({ id }), 'Todo skip', isTodoItem);
    if (result) {
      this._replaceInActiveList(result);
      if (this.selectedTodo?.id === id) {
        this.selectedTodo = result;
      }
    }
  }

  private _replaceInActiveList(result: TodoItem): void {
    const list = this.todosByDomain[result.domain_id];
    if (!list) return;
    const idx = list.findIndex((t) => t.id === result.id);
    if (idx !== -1) list[idx] = result;
  }

  private _replaceInCompletedList(result: TodoItem): void {
    const list = this.completedTodosByDomain[result.domain_id];
    if (!list) return;
    const idx = list.findIndex((t) => t.id === result.id);
    if (idx !== -1) list[idx] = result;
  }

  private _removeFromActiveList(domainId: string, id: string): void {
    const list = this.todosByDomain[domainId];
    if (!list) return;
    this.todosByDomain[domainId] = list.filter((t) => t.id !== id);
  }

  private _removeFromCompletedList(domainId: string, id: string): void {
    const list = this.completedTodosByDomain[domainId];
    if (!list) return;
    this.completedTodosByDomain[domainId] = list.filter((t) => t.id !== id);
  }

  private _sortActiveListByOrder(domainId: string, sortOrder: string[]): void {
    const list = this.todosByDomain[domainId];
    if (!list) return;
    if (sortOrder.length === 0) return;
    const orderMap = new Map<string, number>();
    for (let i = 0; i < sortOrder.length; i++) orderMap.set(sortOrder[i], i);
    list.sort((a, b) => {
      const aIdx = orderMap.get(a.id);
      const bIdx = orderMap.get(b.id);
      if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
      if (aIdx !== undefined) return -1;
      if (bIdx !== undefined) return 1;
      return b.created_at - a.created_at;
    });
  }

  private async _readSortOrder(domainId: string): Promise<string[]> {
    const sortKey = `todo__${domainId}`;
    return requireStringArray(await todoEmitter.getSortOrder({ key: sortKey }), 'Todo sort order');
  }

  private async _writeSortOrder(domainId: string, order: string[]): Promise<void> {
    const sortKey = `todo__${domainId}`;
    requireVoidResult(
      await todoEmitter.setSortOrder({ key: sortKey, order }),
      'Todo sort order update',
    );
  }

  private async _appendToSortOrder(domainId: string, todoId: string): Promise<void> {
    const order = await this._readSortOrder(domainId);
    const filtered = order.filter((id) => id !== todoId);
    filtered.push(todoId);
    await this._writeSortOrder(domainId, filtered);
  }

  private async _removeFromSortOrder(domainId: string, todoId: string): Promise<void> {
    const order = await this._readSortOrder(domainId);
    const filtered = order.filter((id) => id !== todoId);
    await this._writeSortOrder(domainId, filtered);
  }

  private async _prependToSortOrder(domainId: string, todoId: string): Promise<void> {
    const order = await this._readSortOrder(domainId);
    const filtered = order.filter((id) => id !== todoId);
    filtered.unshift(todoId);
    await this._writeSortOrder(domainId, filtered);
  }

  async deleteTodo(id: string, domainId: string): Promise<void> {
    const deleted = await todoEmitter.hardDelete({ id });
    if (typeof deleted !== 'boolean') throw new Error('[todo] Todo delete returned an invalid required result');
    await this._removeFromSortOrder(domainId, id);
    if (this.selectedTodo?.id === id) {
      this.selectedTodo = null;
      this.detailVisible = false;
    }
    this._removeFromActiveList(domainId, id);
    this._removeFromCompletedList(domainId, id);
  }

  async moveTodoToDomain(id: string, fromDomainId: string, toDomainId: string, options?: { targetOrder?: string[] }): Promise<void> {
    requireOptionalItem(
      await todoEmitter.moveToDomain({ id, domainId: toDomainId }),
      'Todo move',
      isTodoItem,
    );
    await this._removeFromSortOrder(fromDomainId, id);
    if (options?.targetOrder) {
      await this.saveTodoOrder(toDomainId, options.targetOrder);
    } else {
      await this._appendToSortOrder(toDomainId, id);
    }
    await this.loadTodosForDomain(fromDomainId);
    await this.loadTodosForDomain(toDomainId);
  }

  async saveTodoOrder(domainId: string, order: string[]): Promise<void> {
    const sortKey = `todo__${domainId}`;
    requireVoidResult(
      await todoEmitter.setSortOrder({ key: sortKey, order }),
      'Todo sort order update',
    );
  }

  async selectTodo(todo: TodoItem): Promise<void> {
    this.selectedTodo = todo;
    this.detailVisible = true;
    await this.loadSubTodos(todo.id);
    this.locateTodo(todo.id, todo.domain_id);
  }

  async selectTodoFromFocused(todo: TodoItem): Promise<void> {
    this.selectedTodo = todo;
    this.detailVisible = true;
    await this.loadSubTodos(todo.id);
    const boardScroll = document.querySelector<HTMLElement>('.todo-app__board-scroll');
    boardScroll?.scrollTo({ left: 0, behavior: 'smooth' });
  }

  locateTodo(todoId: string, domainId: string): void {
    const boardScroll = document.querySelector<HTMLElement>('.todo-app__board-scroll');
    if (!boardScroll) return;

    const columnEl = boardScroll.querySelector<HTMLElement>(`.domain-column[data-domain-id="${domainId}"]`);
    if (!columnEl) return;

    const detailWidth = 320;
    const visibleWidth = boardScroll.clientWidth - detailWidth;
    const columnOffsetLeft = columnEl.offsetLeft;
    const columnWidth = columnEl.offsetWidth;
    const targetScrollLeft = columnOffsetLeft - (visibleWidth - columnWidth) / 2;

    boardScroll.scrollTo({ left: Math.max(0, targetScrollLeft), behavior: 'smooth' });

    const todoRowEl = columnEl.querySelector<HTMLElement>(`[data-todo-id="${todoId}"]`);
    const columnBody = columnEl.querySelector<HTMLElement>('.domain-column__body');
    if (todoRowEl && columnBody) {
      const rowOffsetTop = todoRowEl.offsetTop;
      const rowHeight = todoRowEl.offsetHeight;
      const bodyHeight = columnBody.clientHeight;
      const targetScrollTop = rowOffsetTop - (bodyHeight - rowHeight) / 2;
      columnBody.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
    }
  }

  closeDetail(): void {
    this.detailVisible = false;
    this.selectedTodo = null;
    this.subTodos = [];
  }

  async loadSubTodos(todoId: string): Promise<void> {
    this.subTodos = await this._loadSortedSubTodos(todoId);
  }

  async copyTodoTitle(todo: TodoItem): Promise<void> {
    await this._copyMarkdownText(toInlineMarkdownText(todo.title));
  }

  async copyTodoWithSteps(todo: TodoItem): Promise<void> {
    const markdown = await this._buildTodoMarkdown(todo, { includeNote: false });
    await this._copyMarkdownText(markdown);
  }

  async copyTodoAll(todo: TodoItem): Promise<void> {
    const markdown = await this._buildTodoMarkdown(todo, { includeNote: true });
    await this._copyMarkdownText(markdown);
  }

  private async _buildTodoMarkdown(todo: TodoItem, options: { includeNote: boolean }): Promise<string> {
    const lines: string[] = [];
    const title = toInlineMarkdownText(todo.title);
    const steps = await this._loadSortedSubTodos(todo.id);

    lines.push(`# ${title}`);
    lines.push('');
    lines.push(`## ${i18nHelper.todo.copyStepsHeading}`);
    lines.push('');

    if (steps.length === 0) {
      lines.push(i18nHelper.todo.copyNoSteps);
    } else {
      for (const step of steps) {
        const statusText = step.status === 1
          ? i18nHelper.todo.copyStepCompleted
          : i18nHelper.todo.copyStepIncomplete;
        const checkbox = step.status === 1 ? '[x]' : '[ ]';
        lines.push(`- ${checkbox} ${statusText}: ${toInlineMarkdownText(step.title)}`);
      }
    }

    if (options.includeNote) {
      lines.push('');
      lines.push(`## ${i18nHelper.todo.copyNoteHeading}`);
      lines.push('');
      lines.push(toBlockMarkdownText(todo.note) || i18nHelper.todo.copyNoNote);
    }

    return lines.join('\n');
  }

  private async _copyMarkdownText(markdown: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(markdown);
      Message.success(i18nHelper.todo.copyDone);
    } catch {
      Message.warning(i18nHelper.todo.copyFailed);
    }
  }

  private async _loadSortedSubTodos(todoId: string): Promise<SubTodoItem[]> {
    const subs = requireArray(
      await subTodoEmitter.getByTodoId({ todoId }),
      'SubTodo list',
      isSubTodoItem,
    );
    const sortKey = `subtodo__${todoId}`;
    const sortOrder = requireStringArray(
      await todoEmitter.getSortOrder({ key: sortKey }),
      'SubTodo sort order',
    );

    if (sortOrder.length > 0) {
      const orderMap = new Map<string, number>();
      for (let i = 0; i < sortOrder.length; i++) {
        orderMap.set(sortOrder[i], i);
      }
      subs.sort((a, b) => {
        const aIdx = orderMap.get(a.id);
        const bIdx = orderMap.get(b.id);
        if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
        if (aIdx !== undefined) return -1;
        if (bIdx !== undefined) return 1;
        return a.created_at - b.created_at;
      });
    }

    return subs;
  }

  async refreshSubTodoCounts(todoId: string): Promise<void> {
    const counts = await subTodoEmitter.getCountByTodoId({ todoId });
    if (!isSubTodoCount(counts)) {
      throw new Error('[todo] SubTodo count returned an invalid required result');
    }
    this.subTodoCounts[todoId] = counts;
  }

  async createSubTodo(todoId: string, title: string): Promise<void> {
    requireOptionalItem(await subTodoEmitter.create({ todoId, title }), 'SubTodo create', isSubTodoItem);
    await this.loadSubTodos(todoId);
    await this.refreshSubTodoCounts(todoId);
  }

  async toggleSubTodoStatus(id: string, options?: { wasCompleted: boolean }): Promise<void> {
    const result = requireOptionalItem(
      await subTodoEmitter.toggleStatus({ id }),
      'SubTodo status update',
      isSubTodoItem,
    );
    if (result && this.selectedTodo) {
      if (!options?.wasCompleted) {
        playSuccessSound();
      }
      await this.loadSubTodos(this.selectedTodo.id);
      await this.refreshSubTodoCounts(this.selectedTodo.id);
    }
  }

  async updateSubTodoTitle(id: string, title: string): Promise<void> {
    requireVoidResult(
      await subTodoEmitter.updateTitle({ id, title }),
      'SubTodo title update',
    );
    if (this.selectedTodo) {
      await this.loadSubTodos(this.selectedTodo.id);
    }
  }

  async deleteSubTodo(id: string): Promise<void> {
    requireVoidResult(await subTodoEmitter.hardDelete({ id }), 'SubTodo delete');
    if (this.selectedTodo) {
      await this.loadSubTodos(this.selectedTodo.id);
      await this.refreshSubTodoCounts(this.selectedTodo.id);
    }
  }

  async saveSubTodoOrder(todoId: string, order: string[]): Promise<void> {
    const sortKey = `subtodo__${todoId}`;
    requireVoidResult(
      await todoEmitter.setSortOrder({ key: sortKey, order }),
      'SubTodo sort order update',
    );
  }
}

export const todoStore = reactive(new TodoState()) as TodoState;
todoStore.startCurrentTimeLoop();
