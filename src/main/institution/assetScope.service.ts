export interface AuthorizedAssetInstitution { backend: string; accountId: number; institutionId: number; institutionName: string; namespace: string; generation: string }
let current: AuthorizedAssetInstitution | null = null
let revalidate: (() => Promise<void>) | undefined
const listeners = new Set<() => void>()
export const assetScope = {
  get current(): AuthorizedAssetInstitution | null { return current },
  set(value: AuthorizedAssetInstitution | null): void {
    const changed = value?.generation !== current?.generation || value?.institutionId !== current?.institutionId || value?.accountId !== current?.accountId || value?.backend !== current?.backend
    current = value
    if (changed) for (const listener of listeners) listener()
  },
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } },
  bindRevalidation(operation: () => Promise<void>): void { revalidate = operation },
  async revalidate(): Promise<AuthorizedAssetInstitution | null> { await revalidate?.(); return current }
}
