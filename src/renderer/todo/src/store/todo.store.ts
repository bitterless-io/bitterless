import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { domainEmitter } from '../emitter/domain.emitter';
import { todoEmitter } from '../emitter/todo.emitter';
import { subTodoEmitter } from '../emitter/subTodo.emitter';
import { Message } from '@arco-design/web-vue';
import { playSuccessSound } from '@renderer/common/utils/sound.util';
import { todoSettingStore } from './todoSetting.store';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';

export interface DomainItem {
  id: number;
  title: string;
  is_deleted: number;
  archived: number;
  created_at: number;
  updated_at: number;
}

export interface TodoItem {
  id: number;
  domain_id: number;
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
  is_deleted: number;
  created_at: number;
  updated_at: number;
}

export interface SubTodoItem {
  id: number;
  todo_id: number;
  title: string;
  status: number;
  is_deleted: number;
  created_at: number;
  updated_at: number;
}

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
  todosByDomain: Record<number, TodoItem[]> = {};
  completedTodosByDomain: Record<number, TodoItem[]> = {};
  selectedTodo: TodoItem | null = null;
  subTodos: SubTodoItem[] = [];
  subTodoCounts: Record<number, { total: number; done: number }> = {};
  detailVisible = false;
  newlyCreatedTodoId: number | null = null;

  async loadAll(): Promise<void> {
    this.loading = true;
    try {
      const domains = await domainEmitter.getAll();
      const domainOrder = (await todoEmitter.getSortOrder({ key: 'domain' })) ?? [];

      // Sort domains by sort order, unordered ones at end by created_at ASC
      if (domainOrder.length > 0) {
        const orderMap = new Map<number, number>();
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

      // Load todos for each domain
      for (const domain of domains) {
        await this.loadTodosForDomain(domain.id);
      }
    } finally {
      this.loading = false;
    }
  }

  async loadTodosForDomain(domainId: number): Promise<void> {
    const statusFilter = todoSettingStore.showCompleted ? undefined : 0;
    const todos = await todoEmitter.getByDomainId({ domainId, status: statusFilter });
    const sortKey = `todo__${domainId}`;
    const sortOrder = (await todoEmitter.getSortOrder({ key: sortKey })) ?? [];

    const sortFn = (a: TodoItem, b: TodoItem) => {
      if (sortOrder.length > 0) {
        const orderMap = new Map<number, number>();
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
      const countsMap = await subTodoEmitter.getCountsByTodoIds({ todoIds });
      for (const todo of todos) {
        this.subTodoCounts[todo.id] = countsMap[todo.id] ?? { total: 0, done: 0 };
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

  broadcastDataUpdated(): void {
    xpcRenderer.broadcast('todo/data_updated');
  }

  async createDomain(title?: string): Promise<void> {
    if (this.domainList.length >= 17) {
      Message.warning(i18nHelper.todo.domainLimitReached);
      return;
    }
    const domain = await domainEmitter.create({ title: title ?? 'Untitled' });
    if (domain) {
      this.domainList.push(domain);
      this.todosByDomain[domain.id] = [];
      this.broadcastDataUpdated();
    }
  }

  async updateDomainTitle(id: number, title: string): Promise<void> {
    await domainEmitter.updateTitle({ id, title });
    const domain = this.domainList.find((d) => d.id === id);
    if (domain) {
      domain.title = title;
    }
    this.broadcastDataUpdated();
  }

  async deleteDomain(id: number): Promise<void> {
    await domainEmitter.hardDelete({ id });
    await this._writeSortOrder(id, []);
    this.domainList = this.domainList.filter((d) => d.id !== id);
    delete this.todosByDomain[id];
    delete this.completedTodosByDomain[id];
    this.broadcastDataUpdated();
  }

  async saveDomainOrder(order: number[]): Promise<void> {
    await todoEmitter.setSortOrder({ key: 'domain', order });
    this.broadcastDataUpdated();
  }

  async createTodo(domainId: number, title: string): Promise<void> {
    const activeCount = (this.todosByDomain[domainId] ?? []).length;
    if (activeCount >= 77) {
      Message.warning(i18nHelper.todo.todoLimitReached);
      return;
    }
    const todo = await todoEmitter.create({ domainId, title });
    if (todo) {
      await this._appendToSortOrder(domainId, todo.id);
      const activeList = this.todosByDomain[domainId] ?? [];
      activeList.push(todo);
      this.todosByDomain[domainId] = activeList;
      this.newlyCreatedTodoId = todo.id;
      setTimeout(() => {
        if (this.newlyCreatedTodoId === todo.id) this.newlyCreatedTodoId = null;
      }, 1500);
      this.broadcastDataUpdated();
    }
  }

  async completeTodo(id: number): Promise<void> {
    const result = await todoEmitter.completeTodo({ id });
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
      this.broadcastDataUpdated();
    }
  }

  async uncompleteTodo(id: number): Promise<void> {
    const result = await todoEmitter.uncompleteTodo({ id });
    if (result) {
      await this._appendToSortOrder(result.domain_id, id);
      this._removeFromCompletedList(result.domain_id, id);
      const activeList = this.todosByDomain[result.domain_id] ?? [];
      activeList.push(result);
      this.todosByDomain[result.domain_id] = activeList;
      if (this.selectedTodo?.id === id) {
        this.selectedTodo = result;
      }
      this.broadcastDataUpdated();
    }
  }

  async toggleImportant(id: number): Promise<void> {
    const result = await todoEmitter.toggleImportant({ id });
    if (result) {
      const domainId = result.domain_id;
      if (result.important === 1) {
        await this._prependToSortOrder(domainId, id);
      } else {
        // Insert after the last important=1 item in sort order
        const order = await this._readSortOrder(domainId);
        const list = this.todosByDomain[domainId] ?? [];
        const idMap = new Map<number, TodoItem>();
        for (const t of list) idMap.set(t.id, t);
        // Find the last important=1 item's id in the order (excluding current id)
        let lastImportantId: number | null = null;
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
      this.broadcastDataUpdated();
    }
  }

  async updateTodo(params: {
    id: number;
    title?: string;
    due_at?: number | null;
    remind_at?: number | null;
    note?: string;
    important?: number;
  }): Promise<void> {
    const result = await todoEmitter.update(params);
    if (result) {
      this._replaceInActiveList(result);
      this._replaceInCompletedList(result);
      if (this.selectedTodo?.id === params.id) {
        this.selectedTodo = result;
      }
      this.broadcastDataUpdated();
    }
  }

  async updateRepeatType(id: number, repeatType: string | null): Promise<void> {
    const result = await todoEmitter.updateRepeatType({ id, repeatType });
    if (result) {
      this._replaceInActiveList(result);
      this._replaceInCompletedList(result);
      if (this.selectedTodo?.id === id) {
        this.selectedTodo = result;
      }
      this.broadcastDataUpdated();
    }
  }

  async updateRepeatInterval(id: number, interval: number): Promise<void> {
    const result = await todoEmitter.updateRepeatInterval({ id, interval });
    if (result) {
      this._replaceInActiveList(result);
      this._replaceInCompletedList(result);
      if (this.selectedTodo?.id === id) {
        this.selectedTodo = result;
      }
      this.broadcastDataUpdated();
    }
  }

  async skipToCurrent(id: number): Promise<void> {
    const result = await todoEmitter.skipToCurrent({ id });
    if (result) {
      this._replaceInActiveList(result);
      if (this.selectedTodo?.id === id) {
        this.selectedTodo = result;
      }
      this.broadcastDataUpdated();
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

  private _removeFromActiveList(domainId: number, id: number): void {
    const list = this.todosByDomain[domainId];
    if (!list) return;
    this.todosByDomain[domainId] = list.filter((t) => t.id !== id);
  }

  private _removeFromCompletedList(domainId: number, id: number): void {
    const list = this.completedTodosByDomain[domainId];
    if (!list) return;
    this.completedTodosByDomain[domainId] = list.filter((t) => t.id !== id);
  }

  private _sortActiveListByOrder(domainId: number, sortOrder: number[]): void {
    const list = this.todosByDomain[domainId];
    if (!list) return;
    if (sortOrder.length === 0) return;
    const orderMap = new Map<number, number>();
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

  private async _readSortOrder(domainId: number): Promise<number[]> {
    const sortKey = `todo__${domainId}`;
    return (await todoEmitter.getSortOrder({ key: sortKey })) ?? [];
  }

  private async _writeSortOrder(domainId: number, order: number[]): Promise<void> {
    const sortKey = `todo__${domainId}`;
    await todoEmitter.setSortOrder({ key: sortKey, order });
  }

  private async _appendToSortOrder(domainId: number, todoId: number): Promise<void> {
    const order = await this._readSortOrder(domainId);
    const filtered = order.filter((id) => id !== todoId);
    filtered.push(todoId);
    await this._writeSortOrder(domainId, filtered);
  }

  private async _removeFromSortOrder(domainId: number, todoId: number): Promise<void> {
    const order = await this._readSortOrder(domainId);
    const filtered = order.filter((id) => id !== todoId);
    await this._writeSortOrder(domainId, filtered);
  }

  private async _prependToSortOrder(domainId: number, todoId: number): Promise<void> {
    const order = await this._readSortOrder(domainId);
    const filtered = order.filter((id) => id !== todoId);
    filtered.unshift(todoId);
    await this._writeSortOrder(domainId, filtered);
  }

  async deleteTodo(id: number, domainId: number): Promise<void> {
    await todoEmitter.hardDelete({ id });
    await this._removeFromSortOrder(domainId, id);
    if (this.selectedTodo?.id === id) {
      this.selectedTodo = null;
      this.detailVisible = false;
    }
    this._removeFromActiveList(domainId, id);
    this._removeFromCompletedList(domainId, id);
    this.broadcastDataUpdated();
  }

  async moveTodoToDomain(id: number, fromDomainId: number, toDomainId: number, options?: { targetOrder?: number[] }): Promise<void> {
    await todoEmitter.moveToDomain({ id, domainId: toDomainId });
    await this._removeFromSortOrder(fromDomainId, id);
    if (options?.targetOrder) {
      await this.saveTodoOrder(toDomainId, options.targetOrder);
    } else {
      await this._appendToSortOrder(toDomainId, id);
    }
    await this.loadTodosForDomain(fromDomainId);
    await this.loadTodosForDomain(toDomainId);
    this.broadcastDataUpdated();
  }

  async saveTodoOrder(domainId: number, order: number[]): Promise<void> {
    const sortKey = `todo__${domainId}`;
    await todoEmitter.setSortOrder({ key: sortKey, order });
    this.broadcastDataUpdated();
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

  locateTodo(todoId: number, domainId: number): void {
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

  async loadSubTodos(todoId: number): Promise<void> {
    const subs = await subTodoEmitter.getByTodoId({ todoId });
    const sortKey = `subtodo__${todoId}`;
    const sortOrder = (await todoEmitter.getSortOrder({ key: sortKey })) ?? [];

    if (sortOrder.length > 0) {
      const orderMap = new Map<number, number>();
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

    this.subTodos = subs;
  }

  async refreshSubTodoCounts(todoId: number): Promise<void> {
    const counts = await subTodoEmitter.getCountByTodoId({ todoId });
    this.subTodoCounts[todoId] = counts;
  }

  async createSubTodo(todoId: number, title: string): Promise<void> {
    await subTodoEmitter.create({ todoId, title });
    await this.loadSubTodos(todoId);
    await this.refreshSubTodoCounts(todoId);
    this.broadcastDataUpdated();
  }

  async toggleSubTodoStatus(id: number, options?: { wasCompleted: boolean }): Promise<void> {
    const result = await subTodoEmitter.toggleStatus({ id });
    if (result && this.selectedTodo) {
      if (!options?.wasCompleted) {
        playSuccessSound();
      }
      await this.loadSubTodos(this.selectedTodo.id);
      await this.refreshSubTodoCounts(this.selectedTodo.id);
      this.broadcastDataUpdated();
    }
  }

  async updateSubTodoTitle(id: number, title: string): Promise<void> {
    await subTodoEmitter.updateTitle({ id, title });
    if (this.selectedTodo) {
      await this.loadSubTodos(this.selectedTodo.id);
    }
    this.broadcastDataUpdated();
  }

  async deleteSubTodo(id: number): Promise<void> {
    await subTodoEmitter.hardDelete({ id });
    if (this.selectedTodo) {
      await this.loadSubTodos(this.selectedTodo.id);
      await this.refreshSubTodoCounts(this.selectedTodo.id);
    }
    this.broadcastDataUpdated();
  }

  async saveSubTodoOrder(todoId: number, order: number[]): Promise<void> {
    const sortKey = `subtodo__${todoId}`;
    await todoEmitter.setSortOrder({ key: sortKey, order });
    this.broadcastDataUpdated();
  }
}

export const todoStore = reactive(new TodoState()) as TodoState;
todoStore.startCurrentTimeLoop();
