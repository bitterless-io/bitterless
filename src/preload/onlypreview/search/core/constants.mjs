export const SEARCH_SCHEMA_VERSION = 8;
export const SEARCH_STATE_SCHEMA_VERSION = 1;
export const MAX_INDEX_DEPTH = 32;
export const MAX_TEXT_BYTES = 1024 * 1024;
export const MAX_RESULTS = 500;
export const MAX_BATCH_RESULTS = 50;
export const MAX_BATCH_DELAY_MS = 16;
export const WATCH_TRAILING_MS = 400;
export const CONFIG_QUIET_MS = 60_000;
export const MAX_WATCH_CHANGE_PATHS = 512;
export const BACKGROUND_WORK_SLICE_MS = 8;
export const BACKGROUND_WORK_PAUSE_MS = 4;
export const BACKGROUND_BUILD_TRANSACTION_FILES = 10;
export const SEARCH_WORK_SLICE_MS = 4;
export const ONE_GIB_BYTES = 1024 ** 3;
export const TWO_GIB_BYTES = 2 * 1024 ** 3;

export const CORE_EXCLUDED_DIRECTORY_NAMES = Object.freeze(new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'output',
  // Rust/Cargo 的产物目录(Ral 2026-09-18:「bl cowork 都要默认不去索引 rust 工程产物的目录」)。
  // Maven 也用这个名字装产物,所以这一条对两种工程都是对的。和上面几个同一类风险:一个真的叫
  // `target` 的源码目录会被跳过 —— 与 `build` / `out` / `output` / `vendor` 同一条既有取舍。
  // 更精确的做法是「只有同级存在 Cargo.toml / pom.xml 时才排除」,代价是每个候选目录多一次 stat,
  // 而且硬策略就不再是一张纯名字表(引擎标识、traversal、reconcile 判据都按名字表建的),所以不做。
  'target',
  '.next',
  'coverage',
  '.cache',
  '.turbo',
  '__pycache__',
  '__pypackages__',
  'venv',
  'site-packages',
  'htmlcov',
  'vendor',
  'go-build',
  // 草稿区(Ral 2026-09-23)。CLAUDE.md 明确让 agent 把 `tmp/` 当自由草稿区 —— 实验、解压、
  // 测试夹具、随手建随手删 —— 而它同时被索引,两条规则一直在对撞:2026-09-23 一次
  // `extract_archive` 解压进 `tmp/playground/`,就让两个打包版各自连跑数次全量重建,
  // 最终 7.5 GB swap、整机卡死。草稿区按定义不需要被搜到。
  'tmp',
  'temp',
]));

export const CORE_EXCLUDED_DIRECTORY_SUFFIXES = Object.freeze(['.egg-info', '.dist-info']);
export const CORE_EXCLUDED_DIRECTORY_SEQUENCES = Object.freeze([
  Object.freeze(['pkg', 'mod']),
  Object.freeze(['pkg', 'sumdb']),
]);

export const SENSITIVE_FILE_PATTERNS = Object.freeze([
  /^\.env(?:\..+)?$/iu,
  /^\.npmrc$/iu,
  /^\.netrc$/iu,
  /\.pem$/iu,
  /\.key$/iu,
]);

export const CONTENT_CHUNK_OPTIONS = Object.freeze({
  minGraphemes: 1024,
  targetGraphemes: 2048,
  maxGraphemes: 4096,
  rollingWindowGraphemes: 64,
  rightOverlapCodePoints: 64,
  leftContextGraphemes: 16,
});
