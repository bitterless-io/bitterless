# dao — 数据库操作对象开发目录

## 读写数据
- 使用 `../sqliteHelper/sqlite.helper` 的 `sqliteHelper` 实例进行数据库读写（`safeGet`/`safeAll`/`safeRun`）

## 创建表
- 每张表在 dao 目录下创建对应的 `*.table.ts` 文件（如 `message.table.ts`）
- table 类继承 `base.table.ts` 的 `BaseTable`，声明 `createSql` 属性存放建表 SQL
- 在 `sqlite.preload.ts` 中 import table 实例并通过 `sqliteManager.addTable()` 注册
- `sqliteManager.init()` 时会先执行所有 table 的 `createSql`（`CREATE TABLE IF NOT EXISTS`），再执行 migration

## 修改表（migration）
- 表结构变更（加列、改索引等）通过 `sqliteManager.addMigration(versionCode, sql)` 注册
- migration 仅用于对已有表的修改，不用于建表
- versionCode 格式为 `YYYYMMDDNN`（如 `2026021801`），需大于等于当前应用 versionCode 才会执行

## 注意事项
- 涉及外键的表，`addTable()` 的注册顺序必须保证被引用的表先于引用方注册（父表先于子表），否则建表时外键约束会失败
- migration 同理，含外键变更的 migration 需确保 versionCode 顺序正确，父表的变更先于子表执行
