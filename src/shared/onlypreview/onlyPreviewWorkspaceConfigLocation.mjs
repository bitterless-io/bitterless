/**
 * per-workspace 配置**放在哪里** —— 只有位置,没有解析。
 *
 * 单独成一个模块,有两个理由:
 *
 * 1. **main 也要用它。** 打开 workspace 时要 ensure 这个目录存在(Ral 2026-09-23),而那是
 *    main 侧的写操作。让 main 去 import `workspace-config.mjs` 会把 `yaml` 与 glob 编译一起
 *    拖进主进程包,只为拿两个字符串。
 *
 *    放在 `shared/` 而不是搜索核心里,是因为**两个仓库的 main 打包面对 `@preload` 的可见性不同**:
 *    bitterless 的 main 有 `@preload` 别名,micromeet-cowork 的没有(它的 main 只有 `@main`
 *    与 `@shared`)。从 main 去 import preload 因此在 cowork 会直接构建失败 —— 而
 *    `typecheck` 走的是 tsconfig paths,看不见这件事,只有真正打一次包才会暴露。
 *    `@shared` 两边的 main 都有,搜索核心那边则按既有惯例用相对路径引它
 *    (和 `onlyPreviewSearchDiagnostics.mjs` 同一条路),这样 Node 直跑的测试也解析得到。
 * 2. **这里是本仓与 micromeet-cowork 唯一的差异。** 两个 app 的配置目录不同名
 *    (`.bitterless` / `.micromeet`,Ral 2026-09-23:「因为是不同的应用」),其余代码逐字节相同。
 *    把差异收进一个十行的文件,比散在一个几百行的解析模块里更难被一次整体 re-vendor 悄悄覆盖 ——
 *    而那正是 `onlyPreviewWorkspaceConfigDirectory` 那条守卫存在的理由。
 */
export const WORKSPACE_CONFIG_DIRECTORIES = ['.bitterless'];
export const WORKSPACE_CONFIG_FILE_NAME = 'preview-config.yml';
/** 主名字下的相对路径 —— 对外仍然只暴露一个,给不关心候选顺序的调用方。 */
export const WORKSPACE_CONFIG_RELATIVE_PATH = `${WORKSPACE_CONFIG_DIRECTORIES[0]}/${WORKSPACE_CONFIG_FILE_NAME}`;
