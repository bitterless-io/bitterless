// Trace events emitted by the capture engine (main) and consumed by the renderer.
// Shared across main / preload / renderer via the `@maestro-shared` alias.

// Capture modes:
// - 'ui'  records user actions (click/fill/...) + page snapshots + network.
// - 'api' records network traffic only; UI action/snapshot events are dropped.
export type CaptureMode = 'ui' | 'api'

export type HeaderMap = Record<string, string | string[]>

export interface NetworkTiming {
  requestTime?: number
  proxyStart?: number
  proxyEnd?: number
  dnsStart?: number
  dnsEnd?: number
  connectStart?: number
  connectEnd?: number
  sslStart?: number
  sslEnd?: number
  workerStart?: number
  workerReady?: number
  workerFetchStart?: number
  workerRespondWithSettled?: number
  sendStart?: number
  sendEnd?: number
  pushStart?: number
  pushEnd?: number
  receiveHeadersStart?: number
  receiveHeadersEnd?: number
}

export interface UiActionTarget {
  tag: string
  selector: string
  selectors: string[]
  role?: string
  name?: string
  label?: string
  text?: string
  placeholder?: string
  inputType?: string
}

export interface UiActionStep {
  action: 'click' | 'fill' | 'submit' | 'select' | 'check'
  target: UiActionTarget
  value?: string
  checked?: boolean
  yaml: string
}

export type ResponseBodyOmittedReason =
  | 'unsupported-mime'
  | 'too-large-image'
  | 'binary'
  | 'streaming'
  | 'get-body-failed'
  | 'empty'
  | 'unknown'

export type TraceEvent =
  | {
      kind: 'net.request'
      requestId: string
      method: string
      url: string
      resourceType?: string
      headers?: HeaderMap
      postData?: string | null
      postDataTruncated?: boolean
      ts: number
    }
  | {
      kind: 'net.response'
      requestId: string
      status: number
      mime: string
      url: string
      headers?: HeaderMap
      bodyPreview: string | null
      bodyTruncated?: boolean
      bodyOmittedReason?: ResponseBodyOmittedReason
      bodyByteLength?: number
      bodyBase64Encoded?: boolean
      bodyStreamed?: boolean
      bodyChunkCount?: number
      decodedDataLength?: number
      encodedDataLength?: number
      timing?: NetworkTiming
      ts: number
    }
  | {
      kind: 'action'
      type: UiActionStep['action']
      desc: string
      url: string
      selector?: string
      value?: string
      step: UiActionStep
      // Base64 data-URL thumbnail of the clicked element (click actions only). Display-only:
      // stripped before the trace is persisted / fed to ingest (see maestroWindow.helper.emit).
      shot?: string
      ts: number
    }
  | {
      // A simplified DOM snapshot of the live page — the "element" view a user
      // captures with the Snapshot button, reduced to a YAML structure tree.
      kind: 'snapshot'
      url: string
      title?: string
      nodeCount: number
      yaml: string
      // Base64 data-URL viewport thumbnail. Display-only: stripped before persist/ingest.
      shot?: string
      ts: number
    }
  | { kind: 'info'; msg: string; ts: number }
  | { kind: 'error'; msg: string; ts: number }

export type TraceKind = TraceEvent['kind']
