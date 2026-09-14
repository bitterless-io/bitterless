import type Database from 'better-sqlite3-multiple-ciphers'
import type { SqliteMigration } from '../../common/sqliteMigration.service'

interface TableColumnInfo {
  name: string
}

const CREATE_CONFIG = `
  CREATE TABLE IF NOT EXISTS config (
    domain TEXT NOT NULL,
    key TEXT NOT NULL,
    options TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (domain, key)
  );
`

const CREATE_CAPTURE_FILTER = `
  CREATE TABLE IF NOT EXISTS capture_filter (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    rule TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`

// `kind` / `instance_id` carry a composite mini-app tab, which has no URL to be saved by:
// `kind` names the registered spec to rebuild it through, `instance_id` is the identity that makes
// the rebuilt tab return to its own state (see docs/features/zellij-multi-tab.md).
const CREATE_TABS = `
  CREATE TABLE IF NOT EXISTS tabs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    favicon TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT '',
    instance_id TEXT NOT NULL DEFAULT '',
    alias TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  );
`

const CREATE_BROWSER_HISTORY = `
  CREATE TABLE IF NOT EXISTS browser_history (
    url TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    favicon TEXT NOT NULL DEFAULT '',
    visit_count INTEGER NOT NULL DEFAULT 1,
    last_visited_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_browser_history_recency
    ON browser_history(last_visited_at DESC, visit_count DESC, url ASC);
`

const CREATE_MAESTRO_CHAT_SESSION = `
  CREATE TABLE IF NOT EXISTS cowork_chat_session (
    id TEXT PRIMARY KEY,
    operation_tab_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER,
    detail_json TEXT NOT NULL DEFAULT '{}'
  );
`

const CREATE_MAESTRO_CHAT_MESSAGE = `
  CREATE TABLE IF NOT EXISTS cowork_chat_message (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'cowork',
    role TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    content TEXT NOT NULL DEFAULT '',
    files_json TEXT NOT NULL DEFAULT '[]',
    skill_json TEXT NOT NULL DEFAULT '',
    skills_json TEXT NOT NULL DEFAULT '[]',
    replay_json TEXT NOT NULL DEFAULT '',
    activity_json TEXT NOT NULL DEFAULT '[]',
    tasks_json TEXT NOT NULL DEFAULT '[]',
    confirm_json TEXT NOT NULL DEFAULT '',
    streaming INTEGER NOT NULL DEFAULT 0,
    error INTEGER NOT NULL DEFAULT 0,
    compressed INTEGER NOT NULL DEFAULT 0,
    prompt_excluded INTEGER NOT NULL DEFAULT 0,
    compact_summary TEXT NOT NULL DEFAULT '',
    compact_until_message_id TEXT NOT NULL DEFAULT '',
    token_count INTEGER NOT NULL DEFAULT 0,
    ts INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES cowork_chat_session(id) ON DELETE CASCADE
  );
`

const CREATE_INJECT_BTNS = `
  CREATE TABLE IF NOT EXISTS inject_btns (
    domain TEXT NOT NULL,
    skill_title TEXT NOT NULL,
    skill_description TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (domain, skill_title)
  );
`

const CREATE_MIGRATION = `
  CREATE TABLE IF NOT EXISTS migration (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_code INTEGER NOT NULL UNIQUE,
    executed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`

export const addMaestroColumnIfMissing = (
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as TableColumnInfo[]
  if (columns.some((item) => item.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`)
}

/**
 * apidoc 台账（`drill-001` 阶段二；Ral 2026-09-09「参考 cowork 继续完善 apidoc 需要的」）。
 *
 * 建在**maestro 自己的库**里,不是 core 库 —— apidoc 是 maestro 的产物,
 * 与 core 那批(todo / eyesOnAgents / setting)不同域。
 *
 * 四张表的形状与 cowork 逐字一致,**设计理由连同注释一起搬** —— 那些都是真踩过的坑。
 * 注意:这些注释住在一个 template literal 里,**不能用反引号**,一个就把 SQL 串闭合掉
 * (cowork 2026-08-17 当天踩了三次)。
 */
const CREATE_APIDOC_ENDPOINT = `
  CREATE TABLE IF NOT EXISTS apidoc_endpoint (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id TEXT NOT NULL,
    method TEXT NOT NULL,
    path_template TEXT NOT NULL,
    discriminator TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT '',
    capability TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    source TEXT NOT NULL DEFAULT '',
    seen INTEGER NOT NULL DEFAULT 1,
    first_seen INTEGER NOT NULL DEFAULT 0,
    last_seen INTEGER NOT NULL DEFAULT 0,
    version_code TEXT NOT NULL DEFAULT '',
    dirty INTEGER NOT NULL DEFAULT 0,
    -- 人工判定的读/写(1 = 会改状态, 0 = 只读, NULL = 没人工设过)。
    --
    -- 【必须是列,不能放进 doc_json】:apidoc_contract.doc_json 在冲突时是**整份覆盖**的,
    -- 而模型的判断住在 doc_json 的 x-mm 里 —— 人工改了存那儿,下一次重摄这一页就被静默还原。
    -- 存成列,摄取根本不碰它,"人工赢"是**结构保证**的,不依赖谁记得写 COALESCE。
    --
    -- 读取优先级:mutates_manual ?? 模型的 x-mm ?? 未知(未知 → 写闸按需确认处理)。
    mutates_manual INTEGER,
    UNIQUE (site_id, method, path_template, discriminator)
  );
  CREATE INDEX IF NOT EXISTS idx_apidoc_ep_cat ON apidoc_endpoint(site_id, status, role);
  CREATE INDEX IF NOT EXISTS idx_apidoc_ep_cap ON apidoc_endpoint(site_id, capability);
`

// 详情:一个端点一行(PRIMARY KEY = endpoint_id,所以不可能有两份契约)。
// 字段级检索**不建倒排表** —— doc_json 就是 TEXT,LIKE 全扫在几百端点的规模下是微秒级,
// 而派生副本要同事务重建、会静默过期。
const CREATE_APIDOC_CONTRACT = `
  CREATE TABLE IF NOT EXISTS apidoc_contract (
    endpoint_id INTEGER PRIMARY KEY REFERENCES apidoc_endpoint(id) ON DELETE CASCADE,
    doc_json TEXT NOT NULL,
    servers TEXT NOT NULL DEFAULT '[]',
    auth_shape TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL DEFAULT 0
  );
`

// 功能点 ↔ 端点的绑定。N:M,所以必须独立一张表:一个功能点用 N 个接口(取下拉 → 提交 → 刷新列表),
// 一个接口服务 N 个功能点(列表接口被「查看」「导出前预览」「新增后刷新」共用)。
//
// 两条刻意的决定:
//   ① 端点侧存 **canonical key**(method + path_template + discriminator),不存自增 id ——
//      自增 id 在删站重摄之后会换,按它绑等于按行号绑。
//   ② **没有 FOREIGN KEY / CASCADE**。CASCADE 会在删站或改 path 时静默删掉绑定,
//      而"绑定断了"必须留在库里被看见(LEFT JOIN 出 endpointMissing)。这张表只增不隐。
const CREATE_FUNCTION_ENDPOINT = `
  CREATE TABLE IF NOT EXISTS function_endpoint (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id TEXT NOT NULL,
    function_id TEXT NOT NULL,
    method TEXT NOT NULL,
    path_template TEXT NOT NULL,
    discriminator TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    confidence REAL NOT NULL DEFAULT 0,
    seen INTEGER NOT NULL DEFAULT 1,
    first_seen INTEGER NOT NULL DEFAULT 0,
    last_seen INTEGER NOT NULL DEFAULT 0,
    UNIQUE (site_id, function_id, method, path_template, discriminator)
  );
  CREATE INDEX IF NOT EXISTS idx_fn_ep_function ON function_endpoint(site_id, function_id);
  CREATE INDEX IF NOT EXISTS idx_fn_ep_endpoint ON function_endpoint(site_id, method, path_template, discriminator);
`

// 站点级 metadata。auth_desc = 摄取时 LLM 总结的鉴权方案(人读的一段话,**不含任何凭证值**)。
// 整站一套鉴权,不属于任何单个端点,所以单开一张表;site_id 主键 → 再摄一次直接 UPSERT 覆盖。
const CREATE_APIDOC_SITE = `
  CREATE TABLE IF NOT EXISTS apidoc_site (
    site_id    TEXT PRIMARY KEY,
    auth_desc  TEXT NOT NULL DEFAULT '',
    -- 这批端点真正住的 origin(可能多个,换行分隔,第一个是主的)。**页面站 ≠ API 站** ——
    -- 不在站级记一份,调用侧只能拿当前页面地址兜底,裸路径每一发都打错域名(Ral 2026-08-14)。
    api_base   TEXT NOT NULL DEFAULT '',
    -- 鉴权冒烟:'' 未测 / 'pass' / 'fail'。文档写得漂亮不等于照着能调通,
    -- 打一发真请求才是证据(Ral 2026-08-14)。
    auth_smoke      TEXT NOT NULL DEFAULT '',
    auth_smoke_note TEXT NOT NULL DEFAULT '',
    auth_smoke_at   INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  );
`

export const createMaestroSqliteSchema = (db: Database.Database): void => {
  db.exec(CREATE_CONFIG)
  db.exec(CREATE_CAPTURE_FILTER)
  db.exec(CREATE_TABS)
  db.exec(CREATE_BROWSER_HISTORY)
  db.exec(CREATE_MAESTRO_CHAT_SESSION)
  db.exec(CREATE_MAESTRO_CHAT_MESSAGE)
  db.exec(CREATE_INJECT_BTNS)
  // 顺序有约束:`apidoc_contract` 外键引用 `apidoc_endpoint`,父表必须先建
  // (dao.spec.md 的同一条规矩)。`function_endpoint` 刻意没有外键,顺序自由。
  db.exec(CREATE_APIDOC_ENDPOINT)
  db.exec(CREATE_APIDOC_CONTRACT)
  db.exec(CREATE_FUNCTION_ENDPOINT)
  db.exec(CREATE_APIDOC_SITE)
  db.exec(CREATE_MIGRATION)
}

export const maestroSqliteMigrations: readonly SqliteMigration[] = [
  {
    versionCode: '260625000000',
    runner: (db) => {
      const columns = db.prepare('PRAGMA table_info(capture_filter)').all() as TableColumnInfo[]
      if (!columns.some((column) => column.name === 'domain')) return
      db.exec(`
        DROP INDEX IF EXISTS idx_capture_filter_domain;
        CREATE TABLE capture_filter__new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          rule TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO capture_filter__new (type, rule, value, updated_at)
          SELECT type, rule, value, updated_at FROM capture_filter;
        DROP TABLE capture_filter;
        ALTER TABLE capture_filter__new RENAME TO capture_filter;
      `)
      db.prepare(
        "DELETE FROM config WHERE domain = 'capture' AND key LIKE 'whitelist-enabled:%'",
      ).run()
    },
  },
  {
    versionCode: '260627000001',
    runner: (db) => {
      addMaestroColumnIfMissing(
        db,
        'cowork_chat_message',
        'prompt_excluded',
        'INTEGER NOT NULL DEFAULT 0',
      )
      db.prepare(
        "UPDATE cowork_chat_message SET prompt_excluded = 1, token_count = 0 WHERE role = 'ai' AND TRIM(content) = 'Stopped.'",
      ).run()
    },
  },
  {
    versionCode: '260627000002',
    runner: (db) => {
      addMaestroColumnIfMissing(
        db,
        'cowork_chat_message',
        'compact_summary',
        "TEXT NOT NULL DEFAULT ''",
      )
      addMaestroColumnIfMissing(
        db,
        'cowork_chat_message',
        'compact_until_message_id',
        "TEXT NOT NULL DEFAULT ''",
      )
    },
  },
  {
    versionCode: '260629210704',
    runner: (db) => {
      addMaestroColumnIfMissing(
        db,
        'cowork_chat_message',
        'skill_json',
        "TEXT NOT NULL DEFAULT ''",
      )
      addMaestroColumnIfMissing(
        db,
        'cowork_chat_message',
        'skills_json',
        "TEXT NOT NULL DEFAULT '[]'",
      )
      addMaestroColumnIfMissing(
        db,
        'cowork_chat_message',
        'replay_json',
        "TEXT NOT NULL DEFAULT ''",
      )
    },
  },
  {
    versionCode: '260705083000',
    runner: (db) => {
      db.exec(CREATE_INJECT_BTNS)
    },
  },
  {
    versionCode: '260831200000',
    runner: (db) => {
      addMaestroColumnIfMissing(
        db,
        'cowork_chat_message',
        'tasks_json',
        "TEXT NOT NULL DEFAULT '[]'",
      )
      addMaestroColumnIfMissing(
        db,
        'cowork_chat_message',
        'confirm_json',
        "TEXT NOT NULL DEFAULT ''",
      )
    },
  },
  {
    // Composite mini-app tabs become restorable. Paired with CREATE_TABS above: that one covers a
    // fresh install, this one covers an upgrade — changing only one leaves half the installs broken
    // in a way the other half cannot reproduce (docs/features/sqlite-migration-release-gate.md).
    versionCode: '260911140000',
    runner: (db) => {
      addMaestroColumnIfMissing(db, 'tabs', 'kind', "TEXT NOT NULL DEFAULT ''")
      addMaestroColumnIfMissing(db, 'tabs', 'instance_id', "TEXT NOT NULL DEFAULT ''")
    },
  },
  {
    // Tab alias(docs/features/tab-alias.md #4)。与上面 `CREATE_TABS` 的新列**成对**:那一条管
    // 全新安装,这一条管升级 —— 只改一个,坏掉的那一半装机永远复现不了另一半的问题。
    // `addColumnIfMissing` 形式是硬要求:`runMigrations` 之外的老版本曾经吞掉异常照样记成已执行,
    // 非幂等的 ALTER 会在那种库上永久留下一个缺列。
    versionCode: '260914120000',
    runner: (db) => {
      addMaestroColumnIfMissing(db, 'tabs', 'alias', "TEXT NOT NULL DEFAULT ''")
    },
  },
  {
    versionCode: '260914160000',
    runner: (db) => {
      db.exec(CREATE_BROWSER_HISTORY)
    },
  },
]
