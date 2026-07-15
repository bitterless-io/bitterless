import { join } from 'path'
import { maestroDataRoot } from '@maestro-main/data/maestroDataRoot'

// Maestro's own pi/Codex auth store — under userData (NOT ~/.pi), so the app's ChatGPT login is
// self-contained and independent of any local `pi` CLI. AuthStorage.login (browser OAuth)
// writes here; the agents + getLlmConfig read here via BaseAgent's `authPath`.
export const maestroAuthPath = (): string => {
  return join(maestroDataRoot(), 'pi', 'auth.json')
}
export const maestroModelsPath = (): string => join(maestroDataRoot(), 'pi', 'models.json')
