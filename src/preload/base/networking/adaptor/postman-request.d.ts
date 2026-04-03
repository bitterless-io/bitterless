declare module 'postman-request' {
  export interface RequestOptions {
    method?: string;
    uri?: string;
    url?: string;
    headers?: Record<string, any>;
    body?: any;
    json?: boolean;
    qs?: Record<string, any>;
    timeout?: number;
    followRedirect?: boolean;
    gzip?: boolean;
    encoding?: string | null;
    [key: string]: any;
  }

  type Callback = (error: any, response: any, body: any) => void;

  function request(options: RequestOptions, callback: Callback): any;
  function request(uri: string, options: RequestOptions, callback: Callback): any;
  function request(uri: string, callback: Callback): any;

  export default request;
}
