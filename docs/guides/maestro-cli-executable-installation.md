# Maestro CLI Executable Installation

Status: implemented; owner initialization and packaged-app verification pending

本方案管理 Maestro 随桌面应用分发的 CLI、独立可执行程序和原生模块。目标不是把工具安装到
开发机或用户的全局 `PATH`，而是形成一个可复现、可校验且不进入 `app.asar` 的应用资源目录。

适用范围：

- Micromeet CLI；
- Bun、ripgrep (`rg`)、fd、Ouch；
- AnyDoc JavaScript bundle 和平台原生模块；
- macOS ARM64、macOS x64 和 Windows x64。

Linux 暂不使用新的三平台外部工具仓库，继续走既有 Micromeet CLI、AnyDoc 和 Ouch 准备流程。

## 安装模型

安装分为三个彼此独立的阶段：

```text
固定版本与固定哈希
        |
        | yarn external-tools:init（唯一允许下载外部工具的阶段）
        v
external_tools/{mac_arm,mac_intel,win}
        |
        | 先构建 Micromeet CLI，再离线校验并复制一个目标平台
        v
build/maestro-tools
        |
        | Electron Builder extraResources
        v
<process.resourcesPath>/maestro-tools
```

| 层级 | 目录 | 生命周期 | Git / ASAR 规则 |
|---|---|---|---|
| 本地工具仓库 | `external_tools/{mac_arm,mac_intel,win}` | 初始化一次，版本升级时重建 | 只提交目录、`.gitignore` 和 `.gitkeep`；二进制与 manifest 全部忽略，并排除出 `app.asar` |
| 打包暂存区 | `build/maestro-tools` | 每次打包重新生成 | 生成目录；先放 Micromeet CLI，再合入当前目标平台外部工具 |
| 应用安装目录 | `<process.resourcesPath>/maestro-tools` | 随安装包部署 | Electron `extraResources`；不在 `app.asar` 内 |

macOS 安装包中的实际路径为：

```text
Bitterless.app/Contents/Resources/maestro-tools
```

Windows 使用 Electron 的同一运行时约定：

```text
<Bitterless resources>/maestro-tools
```

## 工具清单

版本由根目录 `package.json` 与 `scripts/maestro/externalTools.cjs` 双重约束，二者不一致时
初始化和打包都会失败。

| 工具 | 固定版本 | 安装来源 | 当前用途 |
|---|---:|---|---|
| Micromeet CLI | 跟随 `packages/micromeet-cli` 源码 | 每次打包从 workspace 构建 | Maestro integration 调用和凭证同步 |
| Bun | `1.3.14` | `external-tools:init` | 为后续迁移能力预置；当前没有启用 Bun skill runner |
| ripgrep (`rg`) | `14.1.1` | `external-tools:init` | 为本地检索能力预置 |
| fd | `10.5.0` | `external-tools:init` | 为本地文件发现能力预置 |
| Ouch | `0.8.2` | `external-tools:init` | Maestro 归档文件创建与解压 |
| AnyDoc | `0.2.4` | `external-tools:init` | Maestro 文档转 Markdown；JavaScript bundle 与 `anydoc.node` 必须成套安装 |

Bun、`rg` 和 `fd` 目前只是被可靠地放入应用资源；本方案不会启用 pi 内置
`grep`/`find`、不会设置进程级 `PI_OFFLINE`，也不会改变模型或 Agent 运行策略。

## 平台映射与安装结果

| 本地仓库目录 | 打包 target | Micromeet CLI | 外部可执行文件 |
|---|---|---|---|
| `external_tools/mac_arm` | `mac_arm` | `micromeet` | `bun`, `rg`, `fd`, `ouch` |
| `external_tools/mac_intel` | `mac_intel` | `micromeet` | `bun`, `rg`, `fd`, `ouch` |
| `external_tools/win` | `win64` | `micromeet.exe` | `bun.exe`, `rg.exe`, `fd.exe`, `ouch.exe` |

每个平台还包含：

```text
external-tools.manifest.json
anydoc/
  anydoc.js
  anydoc.node
  cli.js
  index.js
  package.json
```

`external-tools.manifest.json` 记录 schema、平台、package target、所有工具版本，以及每个
文件的路径、字节数和 SHA-256。校验要求目录树与 allowlist 完全一致，不接受额外文件、
缺失文件、符号链接或被替换的 payload。

## 首次初始化

### 前置条件

- 在 Bitterless 仓库根目录执行命令；
- Node.js 和 Yarn 可用；
- `curl` 和 `tar` 可用；
- macOS/Linux 主机还需要 `unzip`；
- 初始化期间能够访问固定的 GitHub Release 和 npm registry 下载地址。

当前仓库路径下执行：

```bash
cd /Users/ral/Documents/projects/overmind/projects/bitterless
yarn external-tools:init
```

该命令一次初始化 `mac_arm`、`mac_intel` 和 `win` 三个目录，而不是只初始化当前主机。
正常情况下只需执行一次：已有平台会先完整校验，通过后直接复用；缺失或无效的平台会在
临时目录重新下载、校验，然后原子替换。某个平台初始化失败时，既有有效目录会保留。

需要在版本升级后或明确排除本地损坏时重建全部平台：

```bash
yarn external-tools:init --force
```

不要把 `--force` 当作日常打包步骤。不要手工编辑 manifest、跳过哈希校验，或把下载文件
直接复制到平台目录。

初始化完成后，`git status` 不应列出任何二进制或 manifest；三个 `.gitkeep` 仍由 Git
跟踪。

## 打包时的安装顺序

macOS 和 Windows 的标准 package 脚本已经包含完整顺序：

1. 构建 Bitterless release renderer/Main；
2. 从 `packages/micromeet-cli` 构建目标平台 CLI；
3. `prepare-maestro-cli.cjs` 清空并重建 `build/maestro-tools`，写入 CLI 和
   `manifest.json`；
4. `externalTools.cjs stage <target>` 离线校验本地工具仓库，只复制当前 target；
5. `externalTools.cjs verify-stage <target>` 再次验证 CLI target、精确目录树、版本、大小
   和哈希；
6. Electron Builder 把整个 `build/maestro-tools` 安装到
   `Resources/maestro-tools`；
7. macOS 对列入 `mac.binaries` 的可执行文件和 AnyDoc 原生模块签名。

顺序不能交换。`prepare-maestro-cli.cjs` 会清空暂存区，因此如果先 stage 外部工具，再准备
Micromeet CLI，外部工具会被删除。

标准命令示例：

```bash
yarn build_preview:mac_arm
yarn build_preview:mac_intel
yarn build_preview:win
```

Preview、Dev 和 Stable 的 macOS/Windows package 脚本最终共用上述安装链。发布命令和渠道
差异见 [Desktop release channels](../features/desktop-release-channels.md)。

初始化是外部工具下载的唯一网络阶段。后续 `stage` 与 `verify-stage` 不访问网络；完整打包
中的依赖安装、签名、公证或发布仍可能按各自流程访问网络。

## 手工诊断暂存区

标准打包不需要手工执行以下命令。只有在排查目标映射或暂存内容时，才按相同顺序执行：

```bash
node scripts/prepare-maestro-cli.cjs mac_arm
node scripts/maestro/externalTools.cjs stage mac_arm
node scripts/maestro/externalTools.cjs verify-stage mac_arm
```

可替换的 target 只有 `mac_arm`、`mac_intel` 和 `win64`。`win64` 会读取
`external_tools/win`。省略 target 时，脚本只在 macOS ARM64/x64 或 Windows x64 主机上
根据当前平台自动判断。

开发模式下，AnyDoc、Ouch 和 Micromeet CLI 从 `build/maestro-tools` 解析；打包后统一从
`process.resourcesPath/maestro-tools` 解析。Micromeet CLI 启动时会把该资源目录放到它的
`PATH` 前部，使同目录预置工具可被子进程发现。

## 完整性与失败策略

初始化和打包均 fail closed：

- 下载 archive 后先验证固定 SHA-256；AnyDoc npm archive 额外验证 SHA-512；
- 解压后再次验证最终可执行文件、JavaScript bundle 和原生模块的 SHA-256；
- 只接受固定目录、固定文件名和 regular file；不接受符号链接；
- manifest 必须与 `package.json` 的版本 pin 和脚本 inventory 一致；
- stage 前必须存在目标匹配的 Micromeet CLI 与 `manifest.json`；
- stage 会移除另一平台残留的外部工具，再复制当前平台；
- 任一验证失败都会中止打包，并提示先运行 `yarn external-tools:init`。

`external_tools/**` 和旧的 `prebuilt/**` 都被 Electron Builder 排除出 `app.asar`。应用只携带
当前 target 的一份已校验资源，避免源码缓存和安装资源重复占用 ASAR。

## 版本升级流程

升级任何外部工具时必须作为一项完整变更处理：

1. 在 `package.json` 更新对应 `*_version`；
2. 在 `scripts/maestro/externalTools.cjs` 更新固定版本、release URL、archive SHA-256、解压后
   payload SHA-256；AnyDoc 同时更新 npm SHA-512、bundle 哈希和各平台原生模块哈希；
3. 更新 `scripts/maestro/externalTools.test.mjs` 中的预期 inventory；
4. 执行 `yarn external-tools:init --force`，生成三平台新仓库；
5. 执行 `yarn test:maestro-external-tools` 和 `yarn test:desktop-package-audit`；
6. 构建每个受影响 target，并检查安装目录与签名结果。

禁止使用 `latest`、运行时版本解析或未经来源核对就修改哈希。初始化目录和 manifest 仍然
不得提交。

Micromeet CLI 不走上述下载升级流程；它跟随 `packages/micromeet-cli` 源码和 package target
构建。若 CLI 的输出文件名或 target 名变化，必须同步更新 `prepare-maestro-cli.cjs`、运行时
路径解析、打包测试与本文平台映射。

## 故障恢复

| 症状 | 处理方式 |
|---|---|
| 提示 external tools 未初始化或无效 | 重新执行 `yarn external-tools:init`；脚本只重建未通过校验的平台 |
| 下载 archive 哈希不一致 | 停止打包，核对上游 release 是否被替换；不要绕过校验或直接采用新哈希 |
| `curl`、`tar` 或 `unzip` 找不到 | 安装/恢复对应系统工具后重新初始化 |
| staged Micromeet CLI target 不匹配 | 先执行正确 target 的 `prepare-maestro-cli.cjs`，再 stage 同一 target |
| 平台目录存在额外文件、符号链接或损坏文件 | 执行 `yarn external-tools:init --force` 原子重建，不要手工修 manifest |
| `app.asar` 再次异常增大 | 检查 `electron-builder.tmp.yml` 仍排除 `external_tools/**` 和 `prebuilt/**`，并运行 desktop package audit |
| macOS 签名遗漏 | 检查 `mac.binaries` 包含 `micromeet`、`bun`、`rg`、`fd`、`ouch` 和 `anydoc/anydoc.node` |

## Owner 验收清单

- [ ] `yarn external-tools:init` 完成三平台初始化并在第二次运行时全部复用；
- [ ] `git status` 没有出现初始化生成的二进制或 manifest；
- [ ] `yarn test:maestro-external-tools` 通过；
- [ ] `yarn test:desktop-package-audit` 通过；
- [ ] 目标平台包中存在 `Resources/maestro-tools`，且只包含目标平台文件；
- [ ] `app.asar` 不含 `external_tools`、`prebuilt` 或第二份工具 payload；
- [ ] macOS 签名、公证与实际 Maestro 文件读取/归档路径由 owner 验证。

## Source of truth

- 固定版本：`package.json`
- 下载、哈希、manifest、初始化与 stage：`scripts/maestro/externalTools.cjs`
- Micromeet CLI 构建与暂存：`scripts/prepare-maestro-cli.cjs`
- host unpack 分派：`scripts/prepare-maestro-package-tools.cjs`
- Electron 资源复制、ASAR 排除和 macOS 签名清单：`electron-builder.tmp.yml`
- 回归测试：`scripts/maestro/externalTools.test.mjs`、
  `scripts/package/desktopPackageAudit.test.mjs`
- 功能边界：[Maestro sub-application](../features/maestro.md)
- 原问题与交付证据：[Maestro external tools are cached inside app.asar](../issues/maestro-tools-packaged-inside-asar.md)
