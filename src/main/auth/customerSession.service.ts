import type { CustomerSessionPayload } from '@shared/auth/auth.type';

/**
 * 主进程持有的 Core 登录态。
 *
 * 为什么需要它:登录 token 存在**渲染层**的 localStorage(`authToken.service.ts`),
 * 而 `web_search` 这类 agent 工具跑在主进程 —— 主进程读不到 localStorage。
 * 登录成功/会话恢复时由渲染层经 `AuthHandler` 推过来(见 `auth.store.ts`),
 * 主进程在本次运行期内持有。
 *
 * **只放内存,不落盘**:重启后渲染层的 `restoreSession()` 会再推一次,
 * 落盘只是多存一份能被读走的凭据。
 */
class CustomerSessionService {
  private session: CustomerSessionPayload | null = null;
  private listeners = new Set<() => void>();

  set(payload: CustomerSessionPayload): void {
    const token = String(payload?.token || '').trim();
    const baseUrl = String(payload?.baseUrl || '').trim().replace(/\/+$/, '');
    // 半个会话比没有会话更难排查:缺任一件都当作未登录。
    const next = token && baseUrl ? { token, baseUrl } : null;
    const changed = next?.token !== this.session?.token || next?.baseUrl !== this.session?.baseUrl;
    this.session = next;
    if (changed) for (const listener of this.listeners) listener();
  }

  clear(): void {
    this.session = null;
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  get current(): CustomerSessionPayload | null {
    return this.session;
  }
}

export const customerSessionService = new CustomerSessionService();
