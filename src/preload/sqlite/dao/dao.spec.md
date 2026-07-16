# dao — 数据库操作对象开发目录

## 读写数据
- 使用 `../sqliteHelper/sqlite.helper` 的 `sqliteHelper` 实例进行数据库读写（`safeGet`/`safeAll`/`safeRun`）

## 创建表
- 每张表在 dao 目录下创建对应的 `*.table.ts` 文件（如 `message.table.ts`）
- table 类继承 `base.table.ts` 的 `BaseTable`，声明 `createSql` 属性存放建表 SQL
- 在 `sqlite.preload.ts` 中 import table 实例并通过 `sqliteManager.addTable()` 注册
- `sqliteManager.init()` 时会先执行所有 table 的 `createSql`（`CREATE TABLE IF NOT EXISTS`），再执行 migration

## 修改表（migration）
- 表结构变更（加列、改索引等）写入 `coreSqliteMigrations`，运行时与发布审计共用同一清单
- migration 仅用于对已有表的修改，不用于建表
- 新 migration `versionCode` 必须是 12 位字符串 `YYMMDDHHmmss`；所有排序统一通过
  `compare-versions`，历史 8/10 位账本值只作为兼容升级起点

## 注意事项
- 涉及外键的表，`addTable()` 的注册顺序必须保证被引用的表先于引用方注册（父表先于子表），否则建表时外键约束会失败
- migration 同理，含外键变更的 migration 需确保清单顺序正确，父表的变更先于子表执行；
  migration 与账本写入必须在同一个事务中，失败时停止并保持可重试
