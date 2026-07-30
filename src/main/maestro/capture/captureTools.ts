import type { PiToolSpec } from '@maestro-main/agent/BaseAgent'

interface CaptureToolHandlers {
  timeline(args: Record<string, unknown>): string
  search(args: Record<string, unknown>): string
  eventDetail(args: Record<string, unknown>): string
}

export const buildCaptureAnalysisTools = (handlers: CaptureToolHandlers): PiToolSpec[] => [
  {
    name: 'capture_timeline',
    description:
      'Read the CURRENT capture timeline as structured JSON: UI actions/snapshots and API requests/responses interleaved in time. ' +
      'Use this before create_or_update_skill/ingest_recording when the user asks what was captured, which API backs a UI action, why a recording failed, or to summarize the business flow. ' +
      'Default output redacts payload/header values; set include_bodies/include_headers only when needed for diagnosis or skill design.',
    params: [
      { name: 'kind', required: false, description: 'Filter: all, ui, api, snapshot, error. Default all.' },
      { name: 'limit', type: 'number', required: false, description: 'Last N matched events to return (default 80, max 200).' },
      {
        name: 'api_window_ms',
        type: 'number',
        required: false,
        description: 'For UI actions, include likely API requests after the action within this window (default 5000, max 30000; 0 disables).'
      },
      { name: 'api_window_limit', type: 'number', required: false, description: 'Max likely API links per UI action (default 6, max 20).' },
      { name: 'include_bodies', type: 'boolean', required: false, description: 'Include clipped request/response bodies and UI fill values.' },
      { name: 'include_headers', type: 'boolean', required: false, description: 'Include clipped non-sensitive header values; auth/cookie-like headers stay redacted.' }
    ],
    execute: async (args) => handlers.timeline(args)
  },
  {
    name: 'capture_search',
    description:
      'Search the CURRENT capture timeline by URL, method, status, content type, element label/text, request body, response preview, or header name. ' +
      'Use this for long recordings before fetching detail. Returns event indexes/request ids that can be passed to capture_event_detail.',
    params: [
      { name: 'query', required: true, description: 'Case-insensitive words to find, e.g. "POST patients", "401", "booking create".' },
      { name: 'kind', required: false, description: 'Filter: all, ui, api, snapshot, error. Default all.' },
      { name: 'limit', type: 'number', required: false, description: 'Max hits to return (default 80, max 200).' },
      {
        name: 'api_window_ms',
        type: 'number',
        required: false,
        description: 'For UI action hits, include likely API requests after the action within this window (default 5000, max 30000; 0 disables).'
      },
      { name: 'api_window_limit', type: 'number', required: false, description: 'Max likely API links per UI action (default 6, max 20).' },
      { name: 'include_bodies', type: 'boolean', required: false, description: 'Include clipped body/value previews in hits.' },
      { name: 'include_headers', type: 'boolean', required: false, description: 'Include clipped non-sensitive header values in hits.' }
    ],
    execute: async (args) => handlers.search(args)
  },
  {
    name: 'capture_event_detail',
    description:
      'Read one captured event in detail by 1-based event_index or a network request_id. ' +
      'For API events it also returns the matching request/response pair when available plus nearby context. ' +
      'Use this to inspect the exact request/response behind a UI action after capture_timeline or capture_search.',
    params: [
      { name: 'event_index', type: 'number', required: false, description: '1-based event index from capture_timeline/capture_search.' },
      { name: 'request_id', required: false, description: 'Network requestId from capture_timeline/capture_search.' },
      { name: 'around', type: 'number', required: false, description: 'Neighbor events before/after the match (default 2, max 20).' },
      {
        name: 'api_window_ms',
        type: 'number',
        required: false,
        description: 'When event_index points to a UI action, also return likely API requests after it within this window (default 5000, max 30000; 0 disables).'
      },
      { name: 'api_window_limit', type: 'number', required: false, description: 'Max likely API links for the selected UI action (default 6, max 20).' },
      { name: 'include_bodies', type: 'boolean', required: false, description: 'Include clipped request/response bodies and UI fill values.' },
      { name: 'include_headers', type: 'boolean', required: false, description: 'Include clipped non-sensitive header values; auth/cookie-like headers stay redacted.' }
    ],
    execute: async (args) => handlers.eventDetail(args)
  }
]
