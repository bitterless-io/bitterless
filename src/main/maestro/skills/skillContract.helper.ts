import { collectApiReads } from '@maestro-main/drive/replayEngine'
import type { SkillRecipe } from '@maestro-main/skills/skillRecipe.types'

/**
 * Pure skill-contract helpers shared by the skill, agent, and request-execution layers.
 */
export const hasRequiredInputs = (recipe: SkillRecipe): boolean => {
  return recipe.inputs.some((input) => input.required)
}

export const requiredInputNames = (recipe: SkillRecipe): string[] => {
  return recipe.inputs.filter((input) => input.required).map((input) => input.name)
}

export const requiredInputsSatisfied = (
  recipe: SkillRecipe,
  variables: Record<string, string>
): boolean => {
  return recipe.inputs.every((input) => !input.required || Boolean(variables[input.name]))
}

// Value-free auth hint for the contract: from the recorded endpoints' headerPolicy, tell the
// agent WHICH header to send + WHERE to find the token live (candidate storage/cookie keys) +
// any prefix — but NEVER a token value (those are resolved live via read_context at call time).
export const buildAuthHint = (
  items: ReturnType<typeof collectApiReads>
): { header: string; resolve_from: string; candidate_keys: string[]; prefix?: string }[] => {
  const byHeader = new Map<
    string,
    { header: string; resolve_from: string; candidate_keys: string[]; prefix?: string }
  >()
  for (const item of items) {
    for (const policy of item.headerPolicy || []) {
      if (policy.kind === 'static') continue
      const key = policy.header.toLowerCase()
      if (byHeader.has(key)) continue
      byHeader.set(key, {
        header: policy.header,
        resolve_from: 'live page localStorage / sessionStorage / cookie (read_context)',
        candidate_keys: Array.from(
          new Set([...(policy.storageKeys || []), ...(policy.cookieNames || [])])
        ).slice(0, 10),
        prefix: policy.prefix || undefined
      })
    }
  }
  return Array.from(byHeader.values())
}

export const apiEndpointContract = (
  item: ReturnType<typeof collectApiReads>[number],
  fallbackRole: 'option-read' | 'context-read' | 'write' | 'other'
): Record<string, unknown> => {
  return {
    method: (item.method || 'GET').toUpperCase(),
    url: skillEndpointPath(item.url),
    role: item.apiRole || fallbackRole,
    replay: item.replaySafety || (fallbackRole === 'write' ? 'confirm' : 'safe'),
    body_kind: item.bodyKind || (item.requestBody ? 'raw' : 'none')
  }
}

export const skillEndpointPath = (url: string): string => {
  try {
    const parsed = new URL(url)
    const params = Array.from(parsed.searchParams.keys())
    const query = params
      .map((key) => `${encodeURIComponent(key)}=<${skillEndpointVarName(key) || 'value'}>`)
      .join('&')
    return `${sanitizeSkillPath(parsed.pathname)}${query ? `?${query}` : ''}`
  } catch {
    const [path, query = ''] = url.split('?')
    const params = new URLSearchParams(query)
    const queryTemplate = Array.from(params.keys())
      .map((key) => `${encodeURIComponent(key)}=<${skillEndpointVarName(key) || 'value'}>`)
      .join('&')
    return `${sanitizeSkillPath(path)}${queryTemplate ? `?${queryTemplate}` : ''}`
  }
}

export const sanitizeSkillPath = (path: string): string => {
  return path
    .split('/')
    .map((segment) => {
      const decoded = decodeURIComponent(segment)
      if (
        /^[0-9]{5,}$/.test(decoded) ||
        /^[a-f0-9]{8,}-[a-f0-9-]{12,}$/i.test(decoded) ||
        /^[A-Za-z0-9_-]{16,}$/.test(decoded)
      ) {
        return ':id'
      }
      return segment
    })
    .join('/')
}

export const skillEndpointVarName = (label: string): string => {
  return label
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}
