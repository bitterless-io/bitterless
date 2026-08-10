export const TRENCH_JSON_HIGHLIGHT_MAX_BYTES = 128 * 1024;

const utf8Encoder = new TextEncoder();

export const shouldHighlightTrenchJsonDocument = (document: string): boolean =>
  utf8Encoder.encode(document).byteLength <= TRENCH_JSON_HIGHLIGHT_MAX_BYTES;
