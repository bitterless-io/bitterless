import type { AxiosAdapter, InternalAxiosRequestConfig, AxiosResponse } from 'axios';
import request, { type RequestOptions } from 'postman-request';

const buildFullURL = (config: InternalAxiosRequestConfig): string => {
  const base = (config.baseURL || '').replace(/\/+$/, '');
  const url = (config.url || '').replace(/^\/+/, '');
  return base ? `${base}/${url}` : url;
};

export const requestAdaptor: AxiosAdapter = (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
  return new Promise((resolve, reject) => {
    const method = (config.method || 'GET').toUpperCase();
    const fullURL = buildFullURL(config);

    const options: RequestOptions = {
      method,
      uri: fullURL,
      headers: config.headers?.toJSON?.() ?? config.headers ?? {},
      timeout: config.timeout || 0,
      followRedirect: config.maxRedirects !== 0,
      gzip: true,
    };

    if (config.data !== undefined && config.data !== null) {
      if (typeof config.data === 'string') {
        options.body = config.data;
      } else {
        options.json = true;
        options.body = config.data;
      }
    }

    if (config.params) {
      options.qs = config.params;
    }

    if (config.responseType === 'arraybuffer') {
      options.encoding = null;
    }

    request(options, (error: any, response: any, body: any) => {
      if (error) {
        reject(error);
        return;
      }

      let responseData = body;
      if (typeof body === 'string' && config.responseType !== 'text') {
        try {
          responseData = JSON.parse(body);
        } catch {
          responseData = body;
        }
      }

      const axiosResponse: AxiosResponse = {
        data: responseData,
        status: response.statusCode,
        statusText: response.statusMessage || '',
        headers: response.headers,
        config,
        request: response.request,
      };

      if (response.statusCode >= 200 && response.statusCode < 300) {
        resolve(axiosResponse);
      } else {
        const err: any = new Error(`Request failed with status code ${response.statusCode}`);
        err.config = config;
        err.response = axiosResponse;
        err.isAxiosError = true;
        reject(err);
      }
    });
  });
};
