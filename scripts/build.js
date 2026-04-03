const { execSync } = require('child_process');

const run = (cmd) => {
  console.log(`\n▶ ${cmd}\n`);
  execSync(cmd, { stdio: 'inherit', cwd: require('path').resolve(__dirname, '..') });
};

// Step 1: Build main + preload only
run('electron-vite build --config electron.vite.main.config.ts');

// Step 2: Build heavy renderer (home) alone — frees memory after done
run('vite build --config vite.renderer.home.config.ts');

// Step 3: Build remaining light renderers together
run('vite build --config vite.renderer.rest.config.ts');

console.log('\n✅ Build complete\n');
