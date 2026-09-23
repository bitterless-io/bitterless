import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import {
  WORKSPACE_CONFIG_DIRECTORIES,
  WORKSPACE_CONFIG_FILE_NAME
} from '@shared/onlypreview/onlyPreviewWorkspaceConfigLocation.mjs';

/**
 * 首次打开一个 workspace 时,把配置目录与一份空白配置落到盘上(Ral 2026-09-23:
 * 「打开 workspace 需要 ensure .bitterless 或 .micromeet」)。
 *
 * 为什么要落盘而不是"没有就用默认":配置是**人要编辑的东西**,而一个不存在的文件没有任何
 * 可发现性 —— 人得先知道目录叫什么、文件叫什么、schema 长什么样。落一份带注释的空配置,
 * 打开 workspace 的人就能直接改它。
 *
 * 三条纪律:
 *
 * - **绝不覆盖。** 已经有文件就原样不动,连读都不读。`wx` 标志让"存在即失败"由文件系统保证,
 *   而不是靠先 stat 再写那个有竞态的两步。
 * - **绝不阻塞打开。** 只读介质、没有写权限、`.bitterless` 是个普通文件 —— 任何一种都只是
 *   "这次没建成",不该让 workspace 打不开。所以整段吞异常,并把结果作为返回值告知调用方。
 * - **只碰主名字。** 候选目录可能不止一个(历史回落),但新建只建第一个 —— 建一个回落目录
 *   等于制造一份将来会和主名字打架的配置。
 */
const DEFAULT_CONFIG = `# OnlyPreview 的 per-workspace 配置。这份文件由应用在首次打开该 workspace 时创建。
#
# exclude 是一个**有序**的 glob 列表:后面的规则可以推翻前面的,\`!\` 前缀表示重新纳入。
# 例:
#   exclude:
#     - "docs/**"          # 整个 docs 不索引
#     - "!docs/public/**"  # 但 docs/public 还要
#
# 常见的产物与依赖目录(.git / node_modules / dist / build / out / target / tmp 等)已经由
# 内置策略排除,不必在这里重复。凭据类文件(.env / *.pem / *.key 等)同样已内置排除。
version: 1
exclude: []
`;

export interface OnlyPreviewWorkspaceConfigScaffoldResult {
  created: boolean;
  relativePath: string;
}

export const ensureOnlyPreviewWorkspaceConfig = async (
  rootPath: string
): Promise<OnlyPreviewWorkspaceConfigScaffoldResult> => {
  const directoryName = WORKSPACE_CONFIG_DIRECTORIES[0];
  const relativePath = `${directoryName}/${WORKSPACE_CONFIG_FILE_NAME}`;
  if (!rootPath || !isAbsolute(rootPath)) return { created: false, relativePath };
  const directoryPath = join(resolve(rootPath), directoryName);
  try {
    await mkdir(directoryPath, { recursive: true });
    // `wx` = 存在就失败。把"不覆盖"交给文件系统,而不是先 stat 再写 —— 那两步之间别人可以写入。
    await writeFile(join(directoryPath, WORKSPACE_CONFIG_FILE_NAME), DEFAULT_CONFIG, { flag: 'wx' });
    return { created: true, relativePath };
  } catch {
    // 已存在、只读介质、没有写权限、同名普通文件 —— 一律只是"这次没建成"。
    return { created: false, relativePath };
  }
};
