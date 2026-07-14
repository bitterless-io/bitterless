import { join } from 'path'
import { coworkDataRoot } from '@cowork-main/data/coworkDataRoot'

// Cowork's own pi/Codex auth store — under userData (NOT ~/.pi), so the app's ChatGPT login is
// self-contained and independent of any local `pi` CLI. AuthStorage.login (browser OAuth)
// writes here; the agents + getLlmConfig read here via BaseAgent's `authPath`.
export const coworkAuthPath = (): string => {
  return join(coworkDataRoot(), 'pi', 'auth.json')
}
export const coworkModelsPath = (): string => join(coworkDataRoot(), 'pi', 'models.json')
