const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { program } = require('commander');

const SUPPORTED_PLATFORMS = ['mac_arm', 'win64'];

const QDRANT_VERSION = '1.16.3';
const QDRANT_CONFIG = {
  mac_arm: {
    archive: `qdrant-aarch64-apple-darwin.tar.gz`,
    url: `https://github.com/qdrant/qdrant/releases/download/v${QDRANT_VERSION}/qdrant-aarch64-apple-darwin.tar.gz`,
    binary: 'qdrant',
  },
  win64: {
    archive: `qdrant-x86_64-pc-windows-msvc.zip`,
    url: `https://github.com/qdrant/qdrant/releases/download/v${QDRANT_VERSION}/qdrant-x86_64-pc-windows-msvc.zip`,
    binary: 'qdrant.exe',
  },
};

program
  .option('-p, --platform <platform>', `target platform (${SUPPORTED_PLATFORMS.join(', ')})`, 'mac_arm')
  .parse(process.argv);

const opts = program.opts();

if (!SUPPORTED_PLATFORMS.includes(opts.platform)) {
  console.error(`[error] unsupported platform: "${opts.platform}". Supported: ${SUPPORTED_PLATFORMS.join(', ')}`);
  process.exit(1);
}

const platform = opts.platform;
const MODELS_CONFIG = {
  embedding: {
    filename: 'Qwen3-Embedding-0.6B-Q8_0.gguf',
    url: 'https://hf-mirror.com/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/main/Qwen3-Embedding-0.6B-Q8_0.gguf',
  },
  reranker: {
    filename: 'Qwen3-Reranker-0.6B-Q8_0.gguf',
    url: 'https://hf-mirror.com/ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF/resolve/main/qwen3-reranker-0.6b-q8_0.gguf',
  },
};

const EXTERNAL_DIR = path.resolve(__dirname, '..', 'external_resources');
const QDRANT_DIR = path.join(EXTERNAL_DIR, 'qdrant');
const MODELS_DIR = path.join(EXTERNAL_DIR, 'models');

// ensure external_resources dir exists
if (!fs.existsSync(EXTERNAL_DIR)) {
  fs.mkdirSync(EXTERNAL_DIR, { recursive: true });
}

const initQdrant = () => {
  const config = QDRANT_CONFIG[platform];
  const binaryPath = path.join(QDRANT_DIR, config.binary);

  if (fs.existsSync(binaryPath)) {
    console.log(`[qdrant] already exists at ${QDRANT_DIR}, skipping.`);
    return;
  }

  console.log(`[qdrant] downloading ${config.url} ...`);

  const tmpFile = path.join(EXTERNAL_DIR, config.archive);

  try {
    execSync(`curl -L -o "${tmpFile}" "${config.url}"`, { stdio: 'inherit' });

    console.log('[qdrant] extracting ...');

    if (!fs.existsSync(QDRANT_DIR)) {
      fs.mkdirSync(QDRANT_DIR, { recursive: true });
    }

    if (config.archive.endsWith('.tar.gz')) {
      execSync(`tar -xzf "${tmpFile}" -C "${QDRANT_DIR}"`, { stdio: 'inherit' });
    } else if (config.archive.endsWith('.zip')) {
      execSync(`unzip -o "${tmpFile}" -d "${QDRANT_DIR}"`, { stdio: 'inherit' });
    }

    fs.unlinkSync(tmpFile);
    console.log(`[qdrant] installed to ${QDRANT_DIR}`);
  } catch (err) {
    console.error('[qdrant] installation failed:', err.message);
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    process.exit(1);
  }
};

const initModels = () => {
  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  }

  for (const [name, config] of Object.entries(MODELS_CONFIG)) {
    const filePath = path.join(MODELS_DIR, config.filename);

    if (fs.existsSync(filePath)) {
      console.log(`[models] ${name} already exists at ${filePath}, skipping.`);
      continue;
    }

    console.log(`[models] downloading ${name}: ${config.url} ...`);

    try {
      execSync(`curl -L -o "${filePath}" "${config.url}"`, { stdio: 'inherit' });
      console.log(`[models] ${name} downloaded to ${filePath}`);
    } catch (err) {
      console.error(`[models] ${name} download failed:`, err.message);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      process.exit(1);
    }
  }
};

console.log(`[init] platform: ${platform}`);
initQdrant();
initModels();