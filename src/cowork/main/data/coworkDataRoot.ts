import { app } from 'electron'
import { join } from 'path'

export const COWORK_PARTITION = 'persist:bitterless-cowork'

export const coworkDataRoot = (): string => join(app.getPath('userData'), 'cowork')
