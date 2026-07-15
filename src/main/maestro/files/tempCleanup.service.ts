import { unlinkSync } from 'fs'

export const cleanupTempFile = (path: string): void => {
  try {
    unlinkSync(path)
  } catch {
    /* temp cleanup best effort */
  }
}
