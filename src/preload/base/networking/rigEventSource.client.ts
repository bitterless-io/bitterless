import { EventSource } from 'eventsource';

export interface RigEventSourceOptions {
  headers?: Record<string, string>;
  withCredentials?: boolean;
}

export interface RigEventSourceConnection {
  onMessage: (callback: (data: string, event: string, lastEventId: string) => void) => void;
  onError: (callback: (error: { code?: number; message?: string }) => void) => void;
  onOpen: (callback: () => void) => void;
  close: () => void;
}

class RigEventSourceClient {
  private baseURL = '';

  setBaseURL(baseURL: string): void {
    this.baseURL = baseURL.replace(/\/+$/, '');
  }

  private buildURL(url: string): string {
    const path = url.replace(/^\/+/, '');
    return this.baseURL ? `${this.baseURL}/${path}` : path;
  }

  connect(url: string, options?: RigEventSourceOptions): RigEventSourceConnection {
    const fullURL = this.buildURL(url);

    const customHeaders: Record<string, string> = {
      ...options?.headers,
    };

    const customFetch = (input: string | URL, init: any): Promise<Response> => {
      const mergedHeaders = { ...init?.headers, ...customHeaders };
      return fetch(input, { ...init, headers: mergedHeaders });
    };

    const es = new EventSource(fullURL, {
      withCredentials: options?.withCredentials,
      fetch: customFetch as any,
    });

    const connection: RigEventSourceConnection = {
      onMessage: (callback) => {
        es.addEventListener('message', (e: any) => {
          callback(e.data, e.type, e.lastEventId);
        });
      },
      onError: (callback) => {
        es.addEventListener('error', (e: any) => {
          callback({ code: e.code, message: e.message });
        });
      },
      onOpen: (callback) => {
        es.addEventListener('open', () => {
          callback();
        });
      },
      close: () => {
        es.close();
      },
    };

    return connection;
  }
}

export const rEventSourceClient = new RigEventSourceClient();

export const rEventSourceClientExposed = {
  setBaseURL: (baseURL: string): void => rEventSourceClient.setBaseURL(baseURL),
  connect: (url: string, options?: RigEventSourceOptions): RigEventSourceConnection => {
    return rEventSourceClient.connect(url, options);
  },
};
