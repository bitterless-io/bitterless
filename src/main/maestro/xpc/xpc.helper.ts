import './coach.handler'
import '@maestro-main/security/sqliteKey.service'

// Bitterless initializes the shared electron-xpc center. Importing this module registers
// Maestro's handlers without taking ownership of that host lifecycle.
export const initMaestroXpc = (): void => undefined
