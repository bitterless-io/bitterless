export interface InjectBtnInput {
  skillTitle: string
  skillDescription: string
}

export interface InjectBtnEntry extends InjectBtnInput {
  domain: string
  updatedAt: number
}

export interface InjectBtnApi {
  list(params?: { domain?: string }): Promise<InjectBtnEntry[]>
  upsertMany(params: { domain: string; items: InjectBtnInput[] }): Promise<{ ok: boolean; domain: string; count: number }>
  removeDomain(params: { domain: string }): Promise<{ ok: boolean; domain: string; count: number }>
}
