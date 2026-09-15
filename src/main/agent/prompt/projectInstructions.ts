import { readFile } from 'fs/promises'
import { isAbsolute, join } from 'path'

/** A6: exactly the selected project root's AGENTS.md; never discover other instruction files. */
export const readProjectInstructions = async (projectRoot?: string): Promise<string> => {
  if (!projectRoot) return ''
  if (!isAbsolute(projectRoot)) throw new Error('Project instructions require an absolute project root.')
  const path = join(projectRoot, 'AGENTS.md')
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw new Error(`Could not read project instructions at ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!content.trim()) return ''
  return `## Project instructions (AGENTS.md)\n\nSource: ${path}\n\n${content}`
}
