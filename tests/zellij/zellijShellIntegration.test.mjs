/* eslint-disable @typescript-eslint/explicit-function-return-type -- Node runs this isolated JavaScript harness. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';

const directory = mkdtempSync(join(tmpdir(), 'bitterless-zsh-tests-'));
const output = join(directory, 'integration.cjs');
buildSync({
  entryPoints: ['src/main/zellij/zellijShellIntegration.service.ts'],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  tsconfig: 'tsconfig.node.json'
});
const { ensureZellijShellIntegration } = createRequire(import.meta.url)(output);
const assetDirectory = resolve('resources/zellij');
const native = { skip: !existsSync('/bin/zsh') };
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
test.after(() => rmSync(directory, { recursive: true, force: true }));

const fixture = () => {
  const root = mkdtempSync(join(directory, 'case-'));
  const home = join(root, 'home');
  let cwd = join(root, 'chosen cwd');
  mkdirSync(home);
  mkdirSync(cwd);
  cwd = realpathSync(cwd);
  return {
    root,
    home,
    cwd,
    profileDirectory: join(root, "profile's files"),
    assetDirectory,
    selectedShell: '/bin/zsh',
    env: {
      HOME: home,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      CLICOLOR: '1',
      TRACE_FILE: join(root, 'startup.trace')
    }
  };
};
const writeStartup = (target, file, source) => {
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, file), source);
};
const trace = (name) =>
  `print -r -- "${name}|\${ZDOTDIR-<unset>}|\${+functions[_zsh_highlight]}" >> "$TRACE_FILE"\n`;
const run = (f, flags, command, env = ensureZellijShellIntegration(f)) => {
  const result = spawnSync('/bin/zsh', [...flags, '-c', command], {
    env,
    cwd: f.cwd,
    encoding: 'utf8',
    timeout: 10_000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const traceLines = (f) => readFileSync(f.env.TRACE_FILE, 'utf8').trim().split('\n');

test('only the selected default zsh gets private stable shims; caller environment stays unchanged', () => {
  const f = fixture();
  for (const override of [{ selectedShell: '/bin/bash' }, { explicitDefaultShell: '/bin/zsh' }]) {
    assert.equal(ensureZellijShellIntegration({ ...f, ...override }), f.env);
    assert.equal(existsSync(f.profileDirectory), false);
  }
  const original = { ...f.env };
  const env = ensureZellijShellIntegration(f);
  assert.deepEqual(f.env, original);
  assert.equal(env.BITTERLESS_ZSH_ORIGINAL_ZDOTDIR_SET, '0');
  assert.equal(lstatSync(env.ZDOTDIR).mode & 0o777, 0o700);
  const files = readdirSync(env.ZDOTDIR);
  assert.deepEqual(files, ['.zlogin', '.zprofile', '.zshenv', '.zshrc']);
  const before = files.map((file) => lstatSync(join(env.ZDOTDIR, file)));
  assert.deepEqual(ensureZellijShellIntegration(f), env);
  for (const [index, file] of files.entries()) {
    const after = lstatSync(join(env.ZDOTDIR, file));
    assert.equal(after.ino, before[index].ino);
    assert.equal(after.mtimeMs, before[index].mtimeMs);
    assert.equal(after.mode & 0o777, 0o600);
  }
});

for (const flags of [['-i'], ['-i', '-l']]) {
  test(
    `interactive startup ${flags.join(' ')} loads login files once and preserves theme and cwd`,
    native,
    () => {
      const f = fixture();
      writeStartup(f.home, '.zshenv', trace('env') + 'export FIXTURE_VALUE=from-env\n');
      writeStartup(f.home, '.zprofile', trace('profile'));
      writeStartup(f.home, '.zshrc', trace('rc') + "PROMPT='%F{cyan}user-theme%f> '\n");
      writeStartup(f.home, '.zlogin', trace('login'));
      writeStartup(f.home, '.zlogout', trace('logout'));
      const rc = readFileSync(join(f.home, '.zshrc'), 'utf8');
      const result = run(
        f,
        flags,
        'print -r -- "$FIXTURE_VALUE|${ZSH_HIGHLIGHT_VERSION-}|${ZDOTDIR-<unset>}|$PWD|$PROMPT|${+BITTERLESS_ZSH_ORIGINAL_ZDOTDIR_SET}|${+_bitterless_zsh_zdotdir}|${options[login]}"'
      );
      assert.equal(result, `from-env|0.8.0|<unset>|${f.cwd}|%F{cyan}user-theme%f> |0|0|on`);
      assert.deepEqual(traceLines(f), [
        'env|<unset>|0',
        'profile|<unset>|0',
        'rc|<unset>|0',
        'login|<unset>|0',
        'logout|<unset>|1'
      ]);
      assert.equal(readFileSync(join(f.home, '.zshrc'), 'utf8'), rc);
    }
  );
}

test(
  'GUI PATH discovers installed claude commands and a user rc wrapper through the login profile',
  native,
  () => {
    for (const wrapper of [false, true]) {
      const f = fixture();
      const bin = join(f.root, "installed tools' bin");
      mkdirSync(bin);
      for (const command of ['claude', 'claude2']) {
        writeFileSync(join(bin, command), `#!/bin/sh\nprintf '%s\\n' '${command}-fixture'\n`, {
          mode: 0o700
        });
      }
      writeStartup(f.home, '.zprofile', `export PATH=${quote(bin)}:"$PATH"\n`);
      writeStartup(f.home, '.zshrc', wrapper ? 'claude2() { command claude "$@"; }\n' : '');
      // Never execute a real installation, even if a system startup file changes the fixture PATH.
      const command = `[[ $(whence -p claude) == ${quote(join(bin, 'claude'))} && $(whence -p claude2) == ${quote(join(bin, 'claude2'))} ]] || exit 91; command -v claude; whence -w claude2; claude; claude2`;
      assert.equal(
        run(f, ['-i'], command),
        `${bin}/claude\nclaude2: ${wrapper ? 'function' : 'command'}\nclaude-fixture\n${wrapper ? 'claude' : 'claude2'}-fixture`
      );
      assert.equal(f.env.PATH, '/usr/bin:/bin:/usr/sbin:/sbin');
    }
  }
);

for (const flags of [['-i'], ['-i', '-l']]) {
  test(
    `startup ${flags.join(' ')} follows ZDOTDIR changes and loads after login widgets`,
    native,
    () => {
      const f = fixture();
      const original = join(f.root, "original's dotfiles");
      const afterEnv = join(f.root, 'after env');
      const afterProfile = join(f.root, 'after profile');
      f.env.ZDOTDIR = original;
      writeStartup(original, '.zshenv', trace('env') + `export ZDOTDIR=${quote(afterEnv)}\n`);
      writeStartup(
        afterEnv,
        '.zprofile',
        trace('profile') + `unset ZDOTDIR\nZDOTDIR=${quote(afterProfile)}\n`
      );
      writeStartup(afterProfile, '.zshrc', trace('rc'));
      writeStartup(
        afterProfile,
        '.zlogin',
        trace('login') + 'user_widget() { zle .self-insert }\nzle -N user_widget\n'
      );
      writeStartup(afterProfile, '.zlogout', trace('logout'));
      const result = run(
        f,
        flags,
        'print -r -- "${ZSH_HIGHLIGHT_VERSION-}|$ZDOTDIR|${(t)ZDOTDIR}|${widgets[user_widget]}|$PWD"'
      );
      assert.match(result, new RegExp(`^0\\.8\\.0\\|${afterProfile}\\|scalar\\|user:`));
      assert.ok(result.endsWith(`|${f.cwd}`));
      assert.deepEqual(traceLines(f), [
        `env|${original}|0`,
        `profile|${afterEnv}|0`,
        `rc|${afterProfile}|0`,
        `login|${afterProfile}|0`,
        `logout|${afterProfile}|1`
      ]);
    }
  );
}

test(
  'user env can opt out of login startup before profile, rc and logout selection',
  native,
  () => {
    for (const flags of [['-i'], ['-i', '-l']]) {
      const f = fixture();
      writeStartup(f.home, '.zshenv', trace('env') + 'unsetopt login\n');
      for (const [file, name] of [
        ['.zprofile', 'profile'],
        ['.zshrc', 'rc'],
        ['.zlogin', 'login'],
        ['.zlogout', 'logout']
      ])
        writeStartup(f.home, file, trace(name));
      assert.equal(
        run(
          f,
          flags,
          'print -r -- "${options[login]}|${ZSH_HIGHLIGHT_VERSION-}|${ZDOTDIR-<unset>}"'
        ),
        'off|0.8.0|<unset>'
      );
      assert.deepEqual(traceLines(f), ['env|<unset>|0', 'rc|<unset>|0']);
    }
  }
);

test('the -f startup opt-out bypasses managed and user startup files', native, () => {
  const f = fixture();
  for (const file of ['.zshenv', '.zprofile', '.zshrc', '.zlogin', '.zlogout']) {
    writeStartup(f.home, file, trace(file));
  }
  assert.equal(
    run(
      f,
      ['-i', '-f'],
      'print -r -- "${options[login]}|${options[rcs]}|${+functions[_zsh_highlight]}"'
    ),
    'off|off|0'
  );
  assert.equal(existsSync(f.env.TRACE_FILE), false);
});

test(
  'RCS opt-out and noninteractive shells retain normal startup behavior without the plugin',
  native,
  () => {
    for (const flags of [[], ['-l'], ['-i']]) {
      const f = fixture();
      writeStartup(
        f.home,
        '.zshenv',
        trace('env') + (flags.includes('-i') ? 'unsetopt rcs\n' : '')
      );
      writeStartup(f.home, '.zprofile', trace('profile'));
      writeStartup(f.home, '.zshrc', trace('rc'));
      writeStartup(f.home, '.zlogin', trace('login'));
      const result = run(
        f,
        flags,
        'print -r -- "${+functions[_zsh_highlight]}|${ZDOTDIR-<unset>}"'
      );
      assert.equal(result, '0|<unset>');
      assert.deepEqual(
        traceLines(f),
        flags.includes('-l')
          ? ['env|<unset>|0', 'profile|<unset>|0', 'login|<unset>|0']
          : ['env|<unset>|0']
      );
    }
  }
);

test('user nounset and readonly ZDOTDIR options remain effective', native, () => {
  const f = fixture();
  writeStartup(f.home, '.zshenv', 'setopt nounset\n');
  assert.equal(
    run(f, ['-i'], 'print -r -- "$ZSH_HIGHLIGHT_VERSION|${ZDOTDIR-<unset>}|${options[nounset]}"'),
    '0.8.0|<unset>|on'
  );
  const locked = fixture();
  const custom = join(locked.root, 'readonly dotfiles');
  writeStartup(locked.home, '.zshenv', `readonly ZDOTDIR=${quote(custom)}\n`);
  writeStartup(custom, '.zshrc', trace('rc'));
  assert.equal(
    run(locked, ['-i'], 'print -r -- "${+functions[_zsh_highlight]}|$ZDOTDIR|${(t)ZDOTDIR}"'),
    `0|${custom}|scalar-readonly`
  );
  assert.deepEqual(traceLines(locked), [`rc|${custom}|0`]);
});

test('user color opt-outs and existing syntax highlighters take precedence', native, () => {
  for (const source of [
    'export NO_COLOR=1',
    'export NODE_DISABLE_COLORS=1',
    '_zsh_highlight() { :; }',
    'FAST_HIGHLIGHT_VERSION=user-installed'
  ]) {
    const f = fixture();
    writeStartup(f.home, '.zshrc', `${source}\nPROMPT='untouched> '\n`);
    assert.equal(
      run(f, ['-i'], 'print -r -- "${ZSH_HIGHLIGHT_VERSION-missing}|$PROMPT"'),
      'missing|untouched>'
    );
  }
  const f = fixture();
  writeStartup(f.home, '.zshrc', 'export NO_COLOR=\nexport NODE_DISABLE_COLORS=\n');
  assert.equal(run(f, ['-i'], 'print -r -- "$ZSH_HIGHLIGHT_VERSION"'), '0.8.0');
  const loaded = fixture();
  writeStartup(
    loaded.home,
    '.zshrc',
    `source ${quote(join(assetDirectory, 'zsh-syntax-highlighting', 'zsh-syntax-highlighting.zsh'))}\n`
  );
  assert.equal(
    run(loaded, ['-i'], 'print -r -- "${(j:,:)preexec_functions}"'),
    '_zsh_highlight_preexec_hook'
  );
});

test(
  'nested zsh uses the restored user startup environment without adding another app hook',
  native,
  () => {
    const f = fixture();
    const custom = join(f.root, 'custom');
    f.env.ZDOTDIR = custom;
    writeStartup(custom, '.zshenv', trace('env'));
    writeStartup(custom, '.zprofile', trace('profile') + 'export PROFILE_VALUE=from-profile\n');
    writeStartup(custom, '.zshrc', trace('rc'));
    writeStartup(custom, '.zlogin', trace('login'));
    writeStartup(custom, '.zlogout', trace('logout'));
    const result = run(
      f,
      ['-i'],
      `print -r -- "outer|\${+functions[_zsh_highlight]}|$ZDOTDIR|\${options[login]}|$PROFILE_VALUE"; /bin/zsh -ic 'print -r -- "nested|\${+functions[_zsh_highlight]}|$ZDOTDIR|\${options[login]}|$PROFILE_VALUE"'; :`
    );
    assert.equal(result, `outer|1|${custom}|on|from-profile\nnested|0|${custom}|off|from-profile`);
    assert.deepEqual(traceLines(f), [
      `env|${custom}|0`,
      `profile|${custom}|0`,
      `rc|${custom}|0`,
      `login|${custom}|0`,
      `env|${custom}|0`,
      `rc|${custom}|0`,
      `logout|${custom}|1`
    ]);
  }
);

test('asset paths containing shell metacharacters remain literal', native, () => {
  const f = fixture();
  const assets = join(f.root, "assets' $literal");
  symlinkSync(assetDirectory, assets, 'dir');
  assert.equal(
    run({ ...f, assetDirectory: assets }, ['-i'], 'print -r -- "$ZSH_HIGHLIGHT_VERSION"'),
    '0.8.0'
  );
});

test(
  'native PTY renders valid/invalid typed command colors and all sixteen ANSI output colors',
  {
    skip: process.platform !== 'darwin' || !existsSync('/usr/bin/expect'),
    timeout: 25_000
  },
  () => {
    const f = fixture();
    writeStartup(f.home, '.zshrc', "PROMPT='PTY_READY> '\nRPROMPT=''\n");
    // Expect owns the PTY and closes only its child on failure. No real user startup files run.
    const script = String.raw`
set timeout 5
spawn -noecho /bin/zsh -i
expect {
  -exact "PTY_READY> " {}
  timeout { exit 81 }
}
send -- "echo"
expect {
  -re {\x1b\[32m(echo|e)} {}
  timeout { exit 82 }
}
send -- "\025"
send -- "bitterless_invalid_command_xyz"
expect {
  -re {\x1b\[31m} {}
  timeout { exit 83 }
}
send -- "\025"
send -- {for color in {30..37} {90..97}; do printf '\033[%smANSI_%s\033[0m\n' $color $color; done}
send -- "\r"
expect {
  -re {\x1b\[97mANSI_97\x1b\[0m} {}
  timeout { exit 84 }
}
send -- "exit\r"
expect eof
catch wait result
exit [lindex $result 3]
`;
    const result = spawnSync('/usr/bin/expect', ['-c', script], {
      env: ensureZellijShellIntegration(f),
      cwd: f.cwd,
      encoding: 'utf8',
      timeout: 22_000
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, JSON.stringify(result.stdout + result.stderr));
    const output = result.stdout;
    assert.ok(output.includes('\u001b[32me'));
    assert.ok(output.includes('\u001b[31m'));
    for (const color of [
      ...Array.from({ length: 8 }, (_, i) => i + 30),
      ...Array.from({ length: 8 }, (_, i) => i + 90)
    ]) {
      assert.ok(output.includes(`\u001b[${color}mANSI_${color}\u001b[0m`), `ANSI ${color}`);
    }
  }
);
