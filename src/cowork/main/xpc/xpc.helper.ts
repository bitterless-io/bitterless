import './coach.handler'
import '@cowork-main/security/sqliteKey.service'

// Bitterless initializes the shared electron-xpc center. Importing this module registers
// Cowork's handlers without taking ownership of that host lifecycle.
export const initCoworkXpc = (): void => undefined
