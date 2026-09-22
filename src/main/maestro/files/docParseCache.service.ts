import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { maestroDataRoot } from '@maestro-main/data/maestroDataRoot'

/**
 * 文档解析结果的**本地缓存**(Ral 2026-09-01 在 micromeet-cowork 定的口径:
 * 「记住文件路径和更新时间,如果没更新就用缓存」;2026-09-22 Ral 指定同步到 BL)。
 *
 * 为什么 BL 必须有它:没有缓存就没有翻页 —— `read_file` 的 offset/limit 要在**全文**上做,
 * 而 anydoc 转一份长 docx 是秒级的。此前 BL 每次读都重转一遍,并且只转前 120k 字符,
 * 于是一份长文档**永远只有前 120k 可读**,模型却拿着那一截写了完整口吻的总结。
 *
 * 键里有什么、为什么:
 *   · `path + mtimeMs + size` —— 就是"路径 + 更新时间";文件被改过键自然就变了;
 *   · `PARSER_VERSION`        —— 我们自己的解析口径变了要失效;
 *   · `SCHEMA_VERSION`        —— 返回结构变了,旧内容不能直接当新结果用。
 *
 * 放文件而不是配置库:单份 markdown 可到几十万字符,塞进 config DB 会把它撑坏。
 *
 * 与 micromeet-cowork 的差异(**故意的**):BL 这条链没有扫描件的视觉兜底,也没有百炼 relay,
 * 所以键里不含 `model`、`source` 恒为 `anydoc`。那条历史落差要 Ral 单独点名才补
 * (overmind CLAUDE.md「bitterless + micromeet-cowork — paired development」)。
 */
export const PARSER_VERSION = 1
/** 返回结构的版本。`DocParseCacheEntry` 的字段变了就 +1。 */
export const SCHEMA_VERSION = 1

const CACHE_DIR_NAME = 'doc-parse-cache'
/** 条数上限;超了按写入时间淘汰最旧的。缓存是加速器,不是资料库。 */
const MAX_ENTRIES = 500
/** 目录总字节上限(200MB)。两条谁先触发都清。 */
const MAX_TOTAL_BYTES = 200 * 1024 * 1024

export interface DocParseCacheEntry {
  version: number
  path: string
  name: string
  mtimeMs: number
  size: number
  source: 'anydoc'
  schemaVersion: number
  markdown: string
  createdAt: number
}

const cacheDir = (): string => {
  const dir = join(maestroDataRoot(), CACHE_DIR_NAME)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export interface CacheKeyParams {
  path: string
  mtimeMs: number
  size: number
}

export const docParseCacheKey = (params: CacheKeyParams): string =>
  createHash('sha1')
    .update([params.path, params.mtimeMs, params.size, PARSER_VERSION, SCHEMA_VERSION].join('|'))
    .digest('hex')

/** 文件身份(mtime/size)。文件不在了返回 null —— 调用方据此报 not-found,而不是拿旧缓存糊过去。 */
export const fileIdentity = (path: string): { mtimeMs: number; size: number } | null => {
  try {
    const stats = statSync(path)
    if (!stats.isFile()) return null
    return { mtimeMs: stats.mtimeMs, size: stats.size }
  } catch {
    return null
  }
}

export const readDocParseCache = (key: string): DocParseCacheEntry | null => {
  const file = join(cacheDir(), `${key}.json`)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as DocParseCacheEntry
    // 版本不匹配 = 上一代写的,当作没有(键里已含版本,这里只是双保险)。
    if (parsed?.version !== 1 || parsed.schemaVersion !== SCHEMA_VERSION) return null
    return parsed
  } catch {
    // 坏文件当作未命中并删掉 —— 一个写坏的缓存不该让这份文件永远读不了。
    try {
      unlinkSync(file)
    } catch {
      /* ignore */
    }
    return null
  }
}

export const writeDocParseCache = (
  key: string,
  entry: Omit<DocParseCacheEntry, 'version' | 'createdAt'>
): DocParseCacheEntry => {
  const payload: DocParseCacheEntry = { ...entry, version: 1, createdAt: Date.now() }
  try {
    writeFileSync(join(cacheDir(), `${key}.json`), JSON.stringify(payload), 'utf8')
    pruneCache()
  } catch {
    /* 写缓存失败只是少一次加速,不该影响这一次的返回 */
  }
  return payload
}

/**
 * 淘汰:按写入时间从旧到新删,直到条数与总字节都在上限内。
 * 惰性触发(每次写入后),不开定时器 —— 缓存目录只在有人用它的时候增长。
 */
const pruneCache = (): void => {
  const dir = cacheDir()
  let files: { file: string; mtimeMs: number; size: number }[]
  try {
    files = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const stats = statSync(join(dir, name))
        return { file: join(dir, name), mtimeMs: stats.mtimeMs, size: stats.size }
      })
  } catch {
    return
  }
  let total = files.reduce((sum, item) => sum + item.size, 0)
  if (files.length <= MAX_ENTRIES && total <= MAX_TOTAL_BYTES) return
  files.sort((a, b) => a.mtimeMs - b.mtimeMs)
  let remaining = files.length
  for (const item of files) {
    if (remaining <= MAX_ENTRIES && total <= MAX_TOTAL_BYTES) break
    try {
      unlinkSync(item.file)
      total -= item.size
      remaining -= 1
    } catch {
      /* ignore */
    }
  }
}

/**
 * 同一份文件的并发解析只跑一次。附件卡与 `read_file` 可能同时要同一份;不去重就是两次转换,
 * 而结果一模一样。
 */
const inFlight = new Map<string, Promise<DocParseCacheEntry>>()

export const withDocParseInFlight = async (
  key: string,
  run: () => Promise<DocParseCacheEntry>
): Promise<DocParseCacheEntry> => {
  const running = inFlight.get(key)
  if (running) return await running
  const task = run()
  inFlight.set(key, task)
  try {
    return await task
  } finally {
    inFlight.delete(key)
  }
}

/** 给日志用:这条缓存有多久了。 */
export const cacheAgeLabel = (createdAt: number): string => {
  const minutes = Math.max(0, Math.round((Date.now() - createdAt) / 60000))
  if (minutes < 60) return `${minutes}min`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`
}
