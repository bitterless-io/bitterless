import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src')
const skillsView = readFileSync(join(root, 'renderer/maestro/workbench/src/views/WorkbenchSkillsView.vue'), 'utf8')
const workbenchStore = readFileSync(join(root, 'renderer/maestro/workbench/src/workbench.store.ts'), 'utf8')
const coachApi = readFileSync(join(root, 'shared/maestro/coach.api.ts'), 'utf8')
const coachHandler = readFileSync(join(root, 'main/maestro/xpc/coach.handler.ts'), 'utf8')
const maestroWindow = readFileSync(join(root, 'main/maestro/windows/main/maestroWindow.controller.ts'), 'utf8')
const skillService = readFileSync(join(root, 'main/maestro/skills/skill.service.ts'), 'utf8')
const skillRegistry = readFileSync(join(root, 'main/maestro/skills/skillRegistry.service.ts'), 'utf8')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

assert(skillsView.includes('title="Open skill folder"'), 'skill detail header should expose an open-folder button')
assert(skillsView.includes('aria-label="Open skill folder"'), 'open-folder button should be accessible')
assert(skillsView.includes('@click="openSelectedSkillDirectory"'), 'open-folder button should call the store action')
assert(skillsView.includes('<IconFolderOpen'), 'open-folder action should use a familiar folder icon')
assert(!skillsView.includes('>Edit</Button>'), 'skill folder action should not be labeled as ambiguous Edit')

assert(skillsView.includes('const deleteSelectedSkill = async'), 'skill detail should have delete behavior')
assert(skillsView.includes("confirm(`Delete skill"), 'delete should ask the operator to confirm')
assert(skillsView.includes('store.selectedSkill.source === \'builtin\''), 'built-in skills should not be deletable from the UI')
assert(skillsView.includes('status="danger"'), 'delete action should be visually marked as destructive')
assert(skillsView.includes('@click="deleteSelectedSkill"'), 'delete button should call deleteSelectedSkill')

for (const forbidden of [
  'replaySkill(',
  'Replay',
  'variables_json',
  'variablesJson',
  'recording ·',
  'steps ·',
  'apiCount',
  'network.length',
  'ui.length',
  '<textarea'
]) {
  assert(!skillsView.includes(forbidden), `skill detail should not expose replay inputs or recording counters: ${forbidden}`)
}

assert(workbenchStore.includes('async openSelectedSkillDirectory()'), 'workbench store should expose openSelectedSkillDirectory')
assert(workbenchStore.includes('coach.openSkillDirectory({ skillId: this.selectedSkillId })'), 'store should call openSkillDirectory XPC')
assert(workbenchStore.includes('async deleteSelectedSkill()'), 'workbench store should expose deleteSelectedSkill')
assert(workbenchStore.includes("if (!skill || skill.source === 'builtin')"), 'store should reject builtin skill deletion')
assert(workbenchStore.includes('coach.deleteSkill({ skillId: skill.id })'), 'store should call deleteSkill XPC')
assert(workbenchStore.includes('await this.refreshSkills()'), 'store should refresh skills after delete/import')

for (const method of ['openSkillDirectory', 'deleteSkill']) {
  assert(coachApi.includes(`${method}(`), `shared Coach API should expose ${method}`)
  assert(coachHandler.includes(`async ${method}`), `XPC handler should forward ${method}`)
  assert(maestroWindow.includes(`async ${method}`), `main helper should implement ${method}`)
  assert(skillService.includes(`async ${method}`), `SkillService should own ${method}`)
}

assert(skillService.includes('shell.openPath(dir)'), 'openSkillDirectory should open the selected skill directory')
for (const [facade, owner] of [
  ['return await this.skillService.exportSkillPackage(params)', 'async exportSkillPackage(params:'],
  ['return await this.skillService.importSkillPackage()', 'async importSkillPackage():'],
  ['return await this.skillService.replaySkill(params)', 'async replaySkill(params:']
]) {
  assert(maestroWindow.includes(facade), `controller should keep the bounded SkillService facade: ${facade}`)
  assert(skillService.includes(owner), `SkillService should own ${owner}`)
}
assert(skillService.includes("record.event.kind !== 'error' && record.event.kind !== 'info'"), 'skill ingest should filter error/info capture noise')
assert(skillService.includes("capture.source === 'edited' ? 'edited records' : 'events'"), 'skill ingest should preserve capture source reporting')
assert(skillService.includes('this._state.lastAgentRun = {') && skillService.includes('this._state.lastTrainerRun = { skill: result.skill }'), 'SkillService should preserve agent and trainer turn result state')
assert(skillService.includes("xpcMain.broadcast('coach/skills-changed'"), 'SkillService should broadcast successful skill changes')
assert(skillService.includes("errors: ['Skill recipe not found.']") && skillService.includes("errors: ['Browser view is not ready.']"), 'SkillService should preserve missing recipe/browser replay errors')
assert(skillService.includes("message: 'Export cancelled.'") && skillService.includes("message: 'Import cancelled.'"), 'SkillService should preserve import/export cancellation results')
assert(skillRegistry.includes('deleteSkill(skillId: string): DeleteSkillResult'), 'registry should implement deleteSkill')
assert(skillRegistry.includes("if (skill.source === 'builtin')"), 'registry should reject built-in skill deletion')
assert(skillRegistry.includes('isInsideSkillRoot(targetDir)'), 'registry should refuse deletion outside the skill root')
assert(skillRegistry.includes('rmSync(targetDir, { recursive: true, force: true })'), 'registry should remove only the selected skill directory')
assert(coachApi.includes('export interface DeleteSkillResult'), 'shared API should type delete results')

console.log('[check-skill-detail-ux] ok')
