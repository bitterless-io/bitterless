import type { RuntimeConfig } from './types'

export interface TableColumn<T> {
  key: keyof T
  label: string
}

const stringifyCell = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export const printJson = (value: unknown): void => {
  console.log(JSON.stringify(value, null, 2))
}

export const printTable = <T extends Record<string, unknown>>(rows: T[], columns: Array<TableColumn<T>>): void => {
  const widths = columns.map((column) => {
    let width = column.label.length
    for (const row of rows) {
      width = Math.max(width, stringifyCell(row[column.key]).length)
    }
    return Math.min(width, 48)
  })

  const formatRow = (cells: string[]): string =>
    cells
      .map((cell, index) => {
        const value = cell.length > 48 ? `${cell.slice(0, 45)}...` : cell
        return value.padEnd(widths[index])
      })
      .join('  ')
      .trimEnd()

  console.log(formatRow(columns.map((column) => column.label)))
  console.log(formatRow(columns.map((_, index) => '-'.repeat(widths[index]))))
  for (const row of rows) {
    console.log(formatRow(columns.map((column) => stringifyCell(row[column.key]))))
  }
}

export const printConfigSummary = (config: RuntimeConfig): void => {
  console.log(`realm: ${config.realm}`)
  console.log(`region: ${config.region} (${config.regionSource})`)
  console.log(`baseUrl: ${config.baseUrl} (${config.baseUrlSource})`)
  console.log(`credentialFile: ${config.credentialFile} (${config.credentialFileExists ? 'found' : 'missing'})`)
  if (config.credentialError) console.log(`credentialError: ${config.credentialError}`)
  if (config.realm === 'crms' && config.sessionFileExists) {
    console.log(`legacySessionFile: ${config.sessionFile} (found)`)
  }
}
