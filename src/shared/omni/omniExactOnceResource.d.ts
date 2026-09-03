export interface OmniExactOnceResource {
  add(cleanup: () => void): boolean;
  close(): boolean;
}
export function createOmniExactOnceResource(): OmniExactOnceResource;
