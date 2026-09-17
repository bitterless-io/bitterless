import type { CoachXpcContract, SkillSummary } from '@maestro-shared/coach.api'
import type { MaestroChatDetail } from '@maestro-shared/maestroChat.api'

export class SkillPickerStore {
  visible = false
  loading = false
  error = ''
  search = ''
  items: SkillSummary[] = []
  selected: NonNullable<MaestroChatDetail['draft']>['skill']
  private request = 0
  constructor(private readonly coach: Pick<CoachXpcContract, 'skillCatalog'>, private readonly sessionId: () => string) {}
  get filtered(): SkillSummary[] {
    const query = this.search.trim().toLowerCase()
    return this.items.filter(skill => `${skill.name} ${skill.displayName || ''} ${skill.layer} ${skill.path}`.toLowerCase().includes(query))
  }
  available(skill: SkillSummary): boolean { return Boolean(skill.reference && skill.status === 'ready' && skill.scope !== 'unassigned' && skill.enabled !== false) }
  async open(): Promise<void> {
    const request = ++this.request, sessionId = this.sessionId()
    this.visible = true; this.loading = true; this.error = ''; this.search = ''
    try {
      const snapshot = await this.coach.skillCatalog({ sessionId })
      if (request === this.request && sessionId === this.sessionId()) this.items = snapshot.skills
    } catch (error) { if (request === this.request) this.error = String(error) }
    finally { if (request === this.request) this.loading = false }
  }
  pick(skill: SkillSummary): void {
    if (!this.available(skill)) return
    this.selected = { reference: skill.reference!, name: skill.displayName || skill.name, layer: skill.layer || 'global', path: skill.path }
    this.visible = false
  }
  reset(keepSelection = false): void { this.request++; this.visible = false; this.items = []; if (!keepSelection) this.selected = undefined }
}
