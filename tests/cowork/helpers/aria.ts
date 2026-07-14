import { expect, type Locator } from '@playwright/test'

const dedent = (value: string): string => {
  const lines = value.replace(/^\n/, '').replace(/\n\s*$/, '').split('\n')
  const indents = lines.filter((line) => line.trim()).map((line) => line.match(/^\s*/)?.[0].length || 0)
  const minIndent = Math.min(...indents)
  return lines.map((line) => line.slice(minIndent)).join('\n')
}

export const expectAriaSnapshot = async (locator: Locator, snapshot: string): Promise<void> => {
  await expect(locator).toMatchAriaSnapshot(dedent(snapshot))
}
