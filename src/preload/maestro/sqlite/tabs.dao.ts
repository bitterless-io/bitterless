import { XpcPreloadHandler } from 'electron-xpc/preload'
import type { TabsApi, SavedTab } from '@maestro-shared/tabs.api'
import { sqliteManager } from './sqliteManager'

// 列名在这个文件里手写了**三处**(下面这个接口、SELECT、INSERT)。加一列要三处一起改 ——
// 漏掉 SELECT,读回来永远是 undefined;漏掉 INSERT,写进去的永远是默认值。两种都不报错。
interface TabRow {
  url: string
  title: string
  favicon: string
  position: number
  kind: string
  instance_id: string
  alias: string
}

interface TableColumnInfo {
  name: string
}

// XpcPreloadHandler subclass: instantiating it (bottom of file) auto-registers
// `xpc:TabsDao/<method>`, callable from main via createXpcMainEmitter<TabsApi>('TabsDao').
export class TabsDao extends XpcPreloadHandler implements TabsApi {
  /**
   * `alias` 这一列到底在不在 —— **每次都问一遍库,不缓存**。
   *
   * 这不是防御性代码,是一个够得着的真实状态:`runSqliteMigrations` 的「全新库」分支
   * (账本为空且开库前文件不存在)会把**当前构建的 version_code 直接盖进账本、一条迁移都不跑**。
   * 而本地打的 DEBUG/PREVIEW 包,version_code 是打包时刻的时间戳 —— 一个在 alias 列存在之前
   * 打出来、时间戳却比 alias 迁移(260914120000)还大的包,建出来的库账本上写着「已经迁过了」,
   * 表里却根本没有这一列,于是那条迁移**永远**跳过。
   *
   * 这时 `SELECT … alias …` 抛 `no such column: alias`,而渲染层的 `listAll().catch(() => [])`
   * 把它吞成「一个 tab 都没有」:整条持久化 tab 条每次启动静默清空。**缺一列最多是没有别名,
   * 绝不能变成没有 tab** —— 所以读写两侧都按列在不在降级。
   *
   * 不缓存的理由:`listAll` 一次启动只跑一次,`replaceAll` 前面压着 500ms 防抖,PRAGMA 的成本
   * 可以忽略;而缓存要跟着 `sqliteManager.db` 的重开失效,那是一条没人会记得维护的隐性依赖。
   */
  private hasAliasColumn(): boolean {
    const columns = sqliteManager.db.prepare('PRAGMA table_info(tabs)').all() as TableColumnInfo[]
    return columns.some((column) => column.name === 'alias')
  }

  async listAll(): Promise<SavedTab[]> {
    const db = sqliteManager.db
    // 降级读补一格空别名,而不是把 `alias` 从行类型里摘掉:下面的映射只有一份,两条读路径
    // 必须交给它同一个形状,否则「少了一列」会变成「少了一个字段」的类型问题到处扩散。
    const rows = this.hasAliasColumn()
      ? (db
          .prepare('SELECT url, title, favicon, position, kind, instance_id, alias FROM tabs ORDER BY position')
          .all() as TabRow[])
      : (
          db
            .prepare('SELECT url, title, favicon, position, kind, instance_id FROM tabs ORDER BY position')
            .all() as Omit<TabRow, 'alias'>[]
        ).map((row) => ({ ...row, alias: '' }))
    return rows.map((r) => ({
      url: r.url,
      title: r.title,
      favicon: r.favicon,
      position: r.position,
      ...(r.kind ? { kind: r.kind } : {}),
      ...(r.instance_id ? { instanceId: r.instance_id } : {}),
      ...(r.alias ? { alias: r.alias } : {})
    }))
  }

  // Replace the saved set atomically: drop all rows, then insert the new ordered set.
  async replaceAll(params: { tabs: SavedTab[] }): Promise<{ ok: boolean }> {
    const db = sqliteManager.db
    const del = db.prepare('DELETE FROM tabs')
    // 同一条降级:列缺席时照样把其余字段写全,只是这次启动存不下别名。整条 INSERT 报错会让
    // 防抖里的 `.catch()` 吞掉写入,tab 条从此再也不更新。
    const withAlias = this.hasAliasColumn()
    const ins = withAlias
      ? db.prepare(
          'INSERT INTO tabs (url, title, favicon, position, kind, instance_id, alias, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
      : db.prepare(
          'INSERT INTO tabs (url, title, favicon, position, kind, instance_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
    const now = Date.now()
    const run = db.transaction((tabs: SavedTab[]) => {
      del.run()
      for (const t of tabs) {
        const url = (t.url || '').trim()
        const kind = (t.kind || '').trim()
        // A composite mini-app tab is legitimately URL-less — it is restored through its registered
        // spec. Dropping on empty URL alone would silently discard every such row here, one line
        // before the insert, no matter what the caller filtered for.
        if (!url && !kind) continue
        const instanceId = (t.instanceId || '').trim()
        if (withAlias) {
          ins.run(url, t.title || '', t.favicon || '', t.position, kind, instanceId, (t.alias || '').trim(), now)
        } else {
          ins.run(url, t.title || '', t.favicon || '', t.position, kind, instanceId, now)
        }
      }
    })
    run(params.tabs || [])
    return { ok: true }
  }
}

export const tabsDao = new TabsDao()
