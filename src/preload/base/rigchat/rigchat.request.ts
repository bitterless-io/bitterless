import * as request from 'postman-request'

export interface RequestOptions {
  method: 'GET' | 'POST'
  url: string
  params?: Record<string, unknown>
  data?: unknown
  headers?: Record<string, string>
  responseType?: 'arraybuffer' | 'json' | 'text'
  maxRedirects?: number
}

export interface RequestResponse {
  data: any
  headers: Record<string, string | string[]>
  status: number
}

export class RigchatRequest {
  private cookies: Record<string, string> = {}
  private defaultHeaders: Record<string, string> = {
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
    connection: 'close',
  }

  constructor() {
    const getPgv = (c?: string): string => {
      return (
        (c || '') +
        Math.round(2147483647 * (Math.random() || 0.5)) * (+new Date() % 1e10)
      )
    }
    this.cookies['pgv_pvi'] = getPgv()
    this.cookies['pgv_si'] = getPgv('s')
  }

  getCookies(): Record<string, string> {
    return { ...this.cookies }
  }

  setCookies(cookies: Record<string, string>): void {
    Object.assign(this.cookies, cookies)
  }

  private buildCookieHeader(): string {
    return Object.keys(this.cookies)
      .map((key) => `${key}=${this.cookies[key]}`)
      .join('; ')
  }

  private parseCookies(setCookieHeaders: string | string[] | undefined): void {
    if (!setCookieHeaders) return
    const items = Array.isArray(setCookieHeaders)
      ? setCookieHeaders
      : [setCookieHeaders]
    items.forEach((item) => {
      const pm = item.match(/^(.+?)\s?=\s?(.+?);/)
      if (pm) {
        this.cookies[pm[1]] = pm[2]
      }
    })
  }

  private buildUrl(url: string, params?: Record<string, unknown>): string {
    if (!params) return url
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(
        ([k, v]) =>
          `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`
      )
      .join('&')
    if (!qs) return url
    return url + (url.includes('?') ? '&' : '?') + qs
  }

  exec(options: RequestOptions): Promise<RequestResponse> {
    return new Promise((resolve, reject) => {
      const fullUrl = this.buildUrl(options.url, options.params)
      const headers: Record<string, string> = {
        ...this.defaultHeaders,
        cookie: this.buildCookieHeader(),
        ...(options.headers || {}),
      }

      const reqOptions: request.Options = {
        method: options.method,
        url: fullUrl,
        headers,
        timeout: 60000,
        followRedirect: options.maxRedirects !== 0,
        followAllRedirects: options.maxRedirects !== 0,
        encoding: options.responseType === 'arraybuffer' ? null : undefined,
      }

      if (options.data && options.method === 'POST') {
        if (typeof options.data === 'object') {
          reqOptions.json = true
          reqOptions.body = options.data
        } else {
          reqOptions.body = String(options.data)
        }
      }

      if (options.maxRedirects === 0) {
        reqOptions.followRedirect = false
        reqOptions.followAllRedirects = false
      }

      request.default(reqOptions, (error, response, body) => {
        if (error) {
          reject(error)
          return
        }

        this.parseCookies(response.headers['set-cookie'])

        const status = response.statusCode || 0
        let data = body

        if (typeof body === 'string' && !options.responseType) {
          try {
            data = JSON.parse(body)
          } catch {
            // keep as string
          }
        }

        const result: RequestResponse = {
          data,
          headers: response.headers as Record<string, string | string[]>,
          status,
        }

        if (options.maxRedirects === 0 && status === 301) {
          resolve(result)
          return
        }

        if (status >= 200 && status < 400) {
          resolve(result)
        } else {
          const err: any = new Error(`Request failed with status ${status}`)
          err.response = result
          reject(err)
        }
      })
    })
  }
}
