export interface AuthInvalidationPayload {
  reason?: string;
  sessionId?: string;
  source?: string;
  status?: number;
}

/**
 * 登录态从渲染层交到主进程的载荷。主进程的工具(web_search)要带着它调 Core。
 * `baseUrl` 一并传,是为了让"测试还是生产"这个判断只留在 `auth.api.ts` 一处。
 */
export interface CustomerSessionPayload {
  token: string;
  baseUrl: string;
  sessionId: string;
}

export interface AuthSessionApi {
  activateSession(): Promise<void>;
  showHomeWindow(): Promise<void>;
  showPrimaryWindow(): Promise<void>;
  deactivateSession(params?: { sessionId: string }): Promise<void>;
  invalidateSession(params?: AuthInvalidationPayload): Promise<void>;
  setCustomerSession(params: CustomerSessionPayload): Promise<void>;
  clearCustomerSession(params?: { sessionId: string }): Promise<void>;
}
