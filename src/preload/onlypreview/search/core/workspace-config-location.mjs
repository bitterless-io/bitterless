/**
 * per-workspace 配置**放在哪里** —— 只有位置,没有解析。
 *
 * 单独成一个模块,有两个理由:
 *
 * 1. **main 也要用它。** 打开 workspace 时要 ensure 这个目录存在(Ral 2026-09-23),而那是
 *    main 侧的写操作。让 main 去 import `workspace-config.mjs` 会把 `yaml` 与 glob 编译一起
 *    拖进主进程包,只为拿两个字符串。
 * 2. **这里是本仓与 micromeet-cowork 唯一的差异。** 两个 app 的配置目录不同名
 *    (`.bitterless` / `.micromeet`,Ral 2026-09-23:「因为是不同的应用」),其余代码逐字节相同。
 *    把差异收进一个十行的文件,比散在一个几百行的解析模块里更难被一次整体 re-vendor 悄悄覆盖 ——
 *    而那正是 `onlyPreviewWorkspaceConfigDirectory` 那条守卫存在的理由。
 */
export const WORKSPACE_CONFIG_DIRECTORIES = ['.bitterless'];
export const WORKSPACE_CONFIG_FILE_NAME = 'preview-config.yml';
/** 主名字下的相对路径 —— 对外仍然只暴露一个,给不关心候选顺序的调用方。 */
export const WORKSPACE_CONFIG_RELATIVE_PATH = `${WORKSPACE_CONFIG_DIRECTORIES[0]}/${WORKSPACE_CONFIG_FILE_NAME}`;
