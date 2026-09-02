export interface LoginSurfaceCustomer {
  email: string;
  status: 'invited' | 'active' | 'inactive';
  has_password: boolean;
  must_set_password: boolean;
}

export interface LoginSurfaceAuthController {
  readonly current: LoginSurfaceCustomer | null;
  readonly loading: boolean;
  readonly loggingOut: boolean;
  readonly sendingOtp: boolean;
  readonly resettingPassword: boolean;
  readonly checking: boolean;
  readonly defaultRedirect: string;
  readonly handlesOperationErrors: boolean;
  readonly handlesPostAuthNavigation: boolean;
  isAuthenticated(): boolean;
  prepareSurface(): Promise<void>;
  restoreSession(signal?: AbortSignal): Promise<void>;
  cancelSessionRecovery(): void | Promise<void>;
  clearLocalSession(): void | Promise<void>;
  logout(): Promise<void>;
  loginWithPassword(email: string, password: string): Promise<void>;
  sendOtp(email: string, purpose?: 'login' | 'reset_password'): Promise<void>;
  resetPassword(
    email: string,
    code: string,
    newPassword: string,
    passwordConfirmation: string
  ): Promise<void>;
  loginWithOtp(email: string, code: string): Promise<void>;
  changePassword(newPassword: string): Promise<void>;
}

export const loginSurfaceCustomerNeedsPasswordSetup = (
  customer: LoginSurfaceCustomer | null | undefined
): boolean =>
  Boolean(
    customer &&
    (customer.status === 'invited' || customer.must_set_password || !customer.has_password)
  );
