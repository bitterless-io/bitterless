import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import { domainEmitter } from '../emitter/domain.emitter';
import { todoEmitter } from '../emitter/todo.emitter';
import { subTodoEmitter } from '../emitter/subTodo.emitter';
import { playSuccessSound } from '@renderer/common/utils/sound.util';
import { todoSettingStore } from './todoSetting.store';

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
  domainList: DomainItem[] = [];
  todosByDomain: Record<number, TodoItem[]> = {};
  completedTodosByDomain: Record<number, TodoItem[]> = {};
  selectedTodo: TodoItem | null = null;
  subTodos: SubTodoItem[] = [];
  subTodoCounts: Record<number, { total: number; done: number }> = {};
  detailVisible = false;

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
      if (a.important !== b.important) return b.important - a.important;
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

  broadcastDataUpdated(): void {
    xpcRenderer.broadcast('todo/data_updated');
  }

  async createDomain(title?: string): Promise<void> {
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
    const todo = await todoEmitter.create({ domainId, title });
    if (todo) {
      await this.loadTodosForDomain(domainId);
      this.broadcastDataUpdated();
    }
  }

  async completeTodo(id: number): Promise<void> {
    const result = await todoEmitter.completeTodo({ id });
    if (result) {
      playSuccessSound();
      await this.loadTodosForDomain(result.domain_id);
      if (this.selectedTodo?.id === id) {
        this.selectedTodo = result;
      }
      this.broadcastDataUpdated();
    }
  }

  async uncompleteTodo(id: number): Promise<void> {
    const result = await todoEmitter.uncompleteTodo({ id });
    if (result) {
      await this.loadTodosForDomain(result.domain_id);
      if (this.selectedTodo?.id === id) {
        this.selectedTodo = result;
      }
      this.broadcastDataUpdated();
    }
  }

  async toggleImportant(id: number): Promise<void> {
    const result = await todoEmitter.toggleImportant({ id });
    if (result) {
      await this.loadTodosForDomain(result.domain_id);
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
    important?: number;
  }): Promise<void> {
    const result = await todoEmitter.update(params);
    if (result) {
      await this.loadTodosForDomain(result.domain_id);
      if (this.selectedTodo?.id === params.id) {
        this.selectedTodo = result;
      }
      this.broadcastDataUpdated();
    }
  }

  async updateRepeatType(id: number, repeatType: string | null): Promise<void> {
    const result = await todoEmitter.updateRepeatType({ id, repeatType });
    if (result) {
      await this.loadTodosForDomain(result.domain_id);
      if (this.selectedTodo?.id === id) {
        this.selectedTodo = result;
      }
      this.broadcastDataUpdated();
    }
  }

  async skipToCurrent(id: number): Promise<void> {
    const result = await todoEmitter.skipToCurrent({ id });
    if (result) {
      await this.loadTodosForDomain(result.domain_id);
      if (this.selectedTodo?.id === id) {
        this.selectedTodo = result;
      }
      this.broadcastDataUpdated();
    }
  }

  async deleteTodo(id: number, domainId: number): Promise<void> {
    await todoEmitter.hardDelete({ id });
    if (this.selectedTodo?.id === id) {
      this.selectedTodo = null;
      this.detailVisible = false;
    }
    await this.loadTodosForDomain(domainId);
    this.broadcastDataUpdated();
  }

  async moveTodoToDomain(id: number, fromDomainId: number, toDomainId: number): Promise<void> {
    await todoEmitter.moveToDomain({ id, domainId: toDomainId });
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
