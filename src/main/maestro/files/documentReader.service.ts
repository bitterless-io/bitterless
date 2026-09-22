import { basename } from 'node:path'
import { moduleLog } from '@main/logging/moduleLog'
import {
  cacheAgeLabel,
  docParseCacheKey,
  fileIdentity,
  readDocParseCache,
  withDocParseInFlight,
  writeDocParseCache,
  SCHEMA_VERSION,
  type DocParseCacheEntry
} from '@maestro-main/files/docParseCache.service'
import { readFileForAgent, type ReadFileOptions } from '@maestro-main/files/fileReader.service'
import { applyReadGate } from '@maestro-main/files/readGate'

/**
 * 读一份文件的**唯一入口**(`read_file` 工具走这里,不再直接调 `readFileForAgent`)。
 *
 * 两步,顺序是整套机制成立的前提:
 *   1. **存全文** —— `readFileForAgent(fullDocument: true)` 不截断:
 *      文本路给全文逐行编号,文档路给 anydoc 的完整 Markdown(上限 `DOC_CACHE_MAX_CHARS`);
 *      按 `path + mtimeMs + size` 落缓存,同一份文件第二次读是毫秒级。
 *   2. **出口设闸** —— `applyReadGate()` 按 2000 行 ∧ 50KB 裁一次,并给出续读坐标。
 *
 * 先截后存就等于把翻页焊死:那正是 BL 此前的形状 —— 一份长 docx 永远只有前 120k 字符可读,
 * 而模型拿着那一截写了完整口吻的总结。契约见
 * `docs/features/maestro-large-file-chunked-read.md` #3。
 *
 * **不含** micromeet-cowork 那条扫描件视觉兜底(anydoc `needsOcr` → 整份 PDF 交视觉模型)
 * 与百炼 relay:那是独立的历史落差,要 Ral 单独点名才补。这里 `needsOcr` 照旧原样报错。
 */
const dlog = moduleLog('doc-parse')

export interface ReadDocumentResult {
  text: string
  /** 缓存命中时为 `cache`,否则 `anydoc`(含文本路 —— 两者都由 fileReader 产出全文)。 */
  source: DocParseCacheEntry['source'] | 'cache'
}

export const readDocumentForAgent = async (
  absPath: string,
  options?: ReadFileOptions
): Promise<ReadDocumentResult> => {
  const name = basename(absPath)
  const identity = fileIdentity(absPath)
  if (!identity) {
    // 文件不在 / 不是文件:交给 fileReader 报它自己的 not-found,不在这里另编一套话术。
    return { text: await readFileForAgent(absPath, options), source: 'anydoc' }
  }
  const key = docParseCacheKey({ path: absPath, mtimeMs: identity.mtimeMs, size: identity.size })

  const cached = readDocParseCache(key)
  if (cached) {
    dlog.info(`route=cache file=${name}`, {
      route: 'cache',
      file: name,
      age: cacheAgeLabel(cached.createdAt),
      chars: cached.markdown.length
    })
    return { text: applyReadGate(cached.markdown, absPath, options).text, source: 'cache' }
  }

  const entry = await withDocParseInFlight(key, async () => {
    const startedAt = Date.now()
    // 分页在**缓存之后**做,所以这里永远取全文 —— 缓存里存半截等于把翻页焊死。
    const markdown = await readFileForAgent(absPath, {
      ...options,
      offset: undefined,
      limit: undefined,
      fullDocument: true
    })
    dlog.info(`route=anydoc file=${name}`, {
      route: 'anydoc',
      file: name,
      chars: markdown.length,
      ms: Date.now() - startedAt
    })
    return writeDocParseCache(key, {
      path: absPath,
      name,
      mtimeMs: identity.mtimeMs,
      size: identity.size,
      source: 'anydoc',
      schemaVersion: SCHEMA_VERSION,
      markdown
    })
  })

  return { text: applyReadGate(entry.markdown, absPath, options).text, source: entry.source }
}
