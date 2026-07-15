import { app } from 'electron'
import { join } from 'path'

// Keep the original storage identifiers so the product rename does not orphan existing profiles.
export const MAESTRO_PARTITION = 'persist:bitterless-cowork'

export const maestroDataRoot = (): string => join(app.getPath('userData'), 'cowork')
