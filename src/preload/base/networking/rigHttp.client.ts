import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { requestAdaptor } from './adaptor/request.adaptor';

export interface RigHttpRequestOptions {
  params?: Record<string, any>;
  headers?: Record<string, string>;
}

class RigHttpClient {
  private instance: AxiosInstance;

  constructor() {
    this.instance = axios.create({
      adapter: requestAdaptor,
    });
  }

  setBaseURL(baseURL: string): void {
    this.instance.defaults.baseURL = baseURL;
  }

  async get<T = any>(url: string, options?: RigHttpRequestOptions): Promise<AxiosResponse<T>> {
    const config: AxiosRequestConfig = {
      params: options?.params,
      headers: options?.headers,
    };
    return this.instance.get<T>(url, config);
  }

  async post<T = any>(url: string, options?: RigHttpRequestOptions & { data?: any }): Promise<AxiosResponse<T>> {
    const config: AxiosRequestConfig = {
      params: options?.params,
      headers: options?.headers,
    };
    return this.instance.post<T>(url, options?.data, config);
  }
}

export const rHttpClient = new RigHttpClient();

export interface RigHttpResponse<T = any> {
  data: T;
  status: number;
  headers: Record<string, string>;
}

const toExposedResponse = <T>(res: AxiosResponse<T>): RigHttpResponse<T> => ({
  data: res.data,
  status: res.status,
  headers: JSON.parse(JSON.stringify(res.headers)),
});

export const rHttpClientExposed = {
  setBaseURL: (baseURL: string): void => rHttpClient.setBaseURL(baseURL),
  get: async <T = any>(url: string, options?: RigHttpRequestOptions): Promise<RigHttpResponse<T>> => {
    const res = await rHttpClient.get<T>(url, options);
    return toExposedResponse(res);
  },
  post: async <T = any>(url: string, options?: RigHttpRequestOptions & { data?: any }): Promise<RigHttpResponse<T>> => {
    const res = await rHttpClient.post<T>(url, options);
    return toExposedResponse(res);
  },
};
