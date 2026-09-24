export type AccountMenuAction = 'password' | 'logout';

export interface AccountMenuParams {
  x: number;
  y: number;
  email: string;
  signedIn: boolean;
}
