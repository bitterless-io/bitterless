import type { ResponseBodyOmittedReason } from '@maestro-shared/trace.types'

export type ResponseBodyCaptureMode = 'text' | 'image-data-url' | 'omit'

export interface ResponseBodyCapturePolicy {
  captureBody: boolean
  mode: ResponseBodyCaptureMode
  omittedReason?: ResponseBodyOmittedReason
}

export interface ResponseBodyCapturePolicyInput {
  mime?: string
  encodedDataLength?: number
  bodyLimit?: number
}

export const normalizeResponseMime = (mime?: string): string => String(mime || '').split(';')[0].trim().toLowerCase()

export const base64DecodedLength = (value: string): number => {
  const normalized = value.replace(/\s+/g, '')
  if (!normalized) return 0
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding)
}

export const isProbablyBinaryBuffer = (buffer: Buffer): boolean => {
  if (!buffer.length) return false
  const sampleLength = Math.min(buffer.length, 4096)
  let controlCount = 0
  for (let index = 0; index < sampleLength; index += 1) {
    const byte = buffer[index]
    if (byte === 0) return true
    if ((byte < 7 || (byte > 13 && byte < 32)) && byte !== 27) controlCount += 1
  }
  return controlCount / sampleLength > 0.08
}

export const isTextLikeResponseMime = (mime?: string): boolean => {
  const normalized = normalizeResponseMime(mime)
  if (!normalized) return false
  if (isStreamingResponseMime(normalized)) return false
  return (
    normalized.startsWith('text/') ||
    normalized.endsWith('+json') ||
    normalized.endsWith('+xml') ||
    /json|xml|javascript|ecmascript|html|svg|x-www-form-urlencoded|graphql/.test(normalized)
  )
}

export const isStreamingResponseMime = (mime?: string): boolean => {
  const normalized = normalizeResponseMime(mime)
  if (!normalized) return false
  return (
    normalized === 'text/event-stream' ||
    normalized === 'application/x-ndjson' ||
    normalized === 'application/json-seq' ||
    normalized === 'application/grpc' ||
    normalized === 'application/grpc+proto' ||
    normalized === 'application/grpc-web' ||
    normalized === 'application/grpc-web+proto' ||
    normalized === 'application/stream+json' ||
    normalized === 'application/stream-json' ||
    /event-stream|ndjson|json-seq|grpc/.test(normalized)
  )
}

export const isBinaryLikeResponseMime = (mime?: string): boolean => {
  const normalized = normalizeResponseMime(mime)
  if (!normalized) return false
  if (/^(image|font|audio|video)\//.test(normalized)) return true
  return (
    normalized === 'application/octet-stream' ||
    normalized === 'application/pdf' ||
    /zip|gzip|x-7z|x-rar|x-tar|brotli|protobuf|wasm|vnd\.ms-|officedocument/.test(normalized)
  )
}

export const classifyResponseBodyCapture = (input: ResponseBodyCapturePolicyInput): ResponseBodyCapturePolicy => {
  const mime = normalizeResponseMime(input.mime)
  const encodedDataLength = input.encodedDataLength
  const bodyLimit = input.bodyLimit ?? 20_000
  if (encodedDataLength === 0) return { captureBody: false, mode: 'omit', omittedReason: 'empty' }
  if (isStreamingResponseMime(mime)) return { captureBody: false, mode: 'omit', omittedReason: 'streaming' }
  if (isTextLikeResponseMime(mime)) return { captureBody: true, mode: 'text' }
  if (mime.startsWith('image/') && typeof encodedDataLength === 'number' && encodedDataLength <= bodyLimit) {
    return { captureBody: true, mode: 'image-data-url' }
  }
  if (mime.startsWith('image/')) return { captureBody: false, mode: 'omit', omittedReason: 'too-large-image' }
  if (isBinaryLikeResponseMime(mime)) return { captureBody: false, mode: 'omit', omittedReason: 'binary' }
  return { captureBody: false, mode: 'omit', omittedReason: 'unsupported-mime' }
}
