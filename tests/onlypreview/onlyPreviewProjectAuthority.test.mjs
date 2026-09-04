/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync
} from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  expectOnlyPreviewError,
  runtime,
  withTempDirectory,
  write
} from './onlyPreviewCoreTest.helper.mjs';

const runtimeInstanceId = '123e4567-e89b-42d3-a456-426614174000';

test('hidden Project authority owns target inspection, root identity, containment, and node type', async () => {
  await withTempDirectory('onlypreview-project-authority-', async (root) => {
    const project = join(root, 'project');
    const file = write(join(project, 'main.ts'), 'export {};');
    mkdirSync(join(project, 'docs'));
    const outside = write(join(root, 'outside.txt'), 'outside');
    symlinkSync(outside, join(project, 'escape.txt'));

    const inspected = await runtime.inspectOnlyPreviewProjectTarget(file);
    assert.equal(inspected.rootRealPath, realpathSync(project));
    assert.equal(inspected.selectedRelativePath, 'main.ts');

    const authority = new runtime.FileSearchProjectAuthority();
    const binding = await authority.bindWorkspace(
      runtimeInstanceId,
      'workspace-authority',
      project
    );
    assert.deepEqual(binding, {
      runtimeInstanceId,
      workspaceId: 'workspace-authority',
      workspaceGeneration: 1
    });

    const authorizedFile = await authority.authorizeItem(
      runtimeInstanceId,
      binding.workspaceId,
      binding.workspaceGeneration,
      'main.ts'
    );
    assert.equal(authorizedFile.nodeKind, 'file');
    assert.equal(authorizedFile.canonicalPath, realpathSync(file));
    assert.equal(authorizedFile.relativePath, 'main.ts');
    assert.equal(authorizedFile.name, 'main.ts');

    const authorizedDirectory = await authority.authorizeItem(
      runtimeInstanceId,
      binding.workspaceId,
      binding.workspaceGeneration,
      'docs'
    );
    assert.equal(authorizedDirectory.nodeKind, 'directory');
    assert.equal(authorizedDirectory.size, 0);

    const authorizedRoot = await authority.authorizeRoot(
      runtimeInstanceId,
      binding.workspaceId,
      binding.workspaceGeneration
    );
    assert.equal(authorizedRoot.nodeKind, 'directory');
    assert.equal(authorizedRoot.relativePath, '');
    assert.equal(authorizedRoot.canonicalPath, realpathSync(project));

    await assert.rejects(
      authority.authorizeItem(
        runtimeInstanceId,
        binding.workspaceId,
        binding.workspaceGeneration,
        '../outside.txt'
      ),
      expectOnlyPreviewError('INVALID_INPUT')
    );
    await assert.rejects(
      authority.authorizeItem(
        runtimeInstanceId,
        binding.workspaceId,
        binding.workspaceGeneration,
        'escape.txt'
      ),
      expectOnlyPreviewError('PATH_NOT_REGULAR_FILE')
    );

    const movedProject = join(root, 'project-moved');
    renameSync(project, movedProject);
    symlinkSync(movedProject, project, 'dir');
    await assert.rejects(
      authority.authorizeRoot(runtimeInstanceId, binding.workspaceId, binding.workspaceGeneration),
      expectOnlyPreviewError('PATH_OUTSIDE_WORKSPACE')
    );
  });
});

test('Delete grants are opaque, cancelable, one-shot, generation-bound, and replacement-fenced', async () => {
  await withTempDirectory('onlypreview-project-delete-', async (root) => {
    const first = write(join(root, 'first.txt'), 'first');
    const replaced = write(join(root, 'replace.txt'), 'original');
    const authority = new runtime.FileSearchProjectAuthority();
    const binding = await authority.bindWorkspace(runtimeInstanceId, 'workspace-delete', root);

    const cancelled = await authority.prepareDelete(
      runtimeInstanceId,
      binding.workspaceId,
      binding.workspaceGeneration,
      'first.txt'
    );
    assert.match(cancelled.grantId, /^[0-9a-f-]{36}$/i);
    assert.equal(Object.hasOwn(cancelled, 'canonicalPath'), false);
    await authority.cancelDelete(
      runtimeInstanceId,
      binding.workspaceId,
      binding.workspaceGeneration,
      cancelled.grantId,
      'first.txt'
    );
    await assert.rejects(
      authority.commitDelete(
        runtimeInstanceId,
        binding.workspaceId,
        binding.workspaceGeneration,
        cancelled.grantId,
        'first.txt'
      ),
      expectOnlyPreviewError('INVALID_INPUT')
    );
    assert.equal(existsSync(first), true);

    const raced = await authority.prepareDelete(
      runtimeInstanceId,
      binding.workspaceId,
      binding.workspaceGeneration,
      'replace.txt'
    );
    const retired = join(root, 'retired.txt');
    renameSync(replaced, retired);
    write(replaced, 'replacement');
    await assert.rejects(
      authority.commitDelete(
        runtimeInstanceId,
        binding.workspaceId,
        binding.workspaceGeneration,
        raced.grantId,
        'replace.txt'
      ),
      expectOnlyPreviewError('PATH_NOT_FOUND')
    );
    assert.equal(existsSync(replaced), true);
    assert.equal(existsSync(retired), true);

    const committed = await authority.prepareDelete(
      runtimeInstanceId,
      binding.workspaceId,
      binding.workspaceGeneration,
      'first.txt'
    );
    const result = await authority.commitDelete(
      runtimeInstanceId,
      binding.workspaceId,
      binding.workspaceGeneration,
      committed.grantId,
      'first.txt'
    );
    assert.equal(result.relativePath, 'first.txt');
    assert.equal(existsSync(first), false);
    await assert.rejects(
      authority.commitDelete(
        runtimeInstanceId,
        binding.workspaceId,
        binding.workspaceGeneration,
        committed.grantId,
        'first.txt'
      ),
      expectOnlyPreviewError('INVALID_INPUT')
    );

    const stale = await authority.prepareDelete(
      runtimeInstanceId,
      binding.workspaceId,
      binding.workspaceGeneration,
      'replace.txt'
    );
    const rebound = await authority.bindWorkspace(runtimeInstanceId, 'workspace-rebound', root);
    assert.equal(rebound.workspaceGeneration, 2);
    await assert.rejects(
      authority.commitDelete(
        runtimeInstanceId,
        binding.workspaceId,
        binding.workspaceGeneration,
        stale.grantId,
        'replace.txt'
      ),
      expectOnlyPreviewError('INVALID_INPUT')
    );
    await assert.rejects(
      authority.authorizeItem(
        runtimeInstanceId,
        binding.workspaceId,
        binding.workspaceGeneration,
        'replace.txt'
      ),
      expectOnlyPreviewError('WORKSPACE_ACCESS_DENIED')
    );
    assert.equal(existsSync(replaced), true);
  });
});

test('Delete atomically isolates the directory entry and restores a raced replacement', async () => {
  await withTempDirectory('onlypreview-project-delete-isolation-', async (root) => {
    const target = write(join(root, 'target.txt'), 'pinned original');
    const retired = join(root, 'retired-original.txt');
    let isolatedEntry = '';
    const operations = {
      ...runtime.projectAuthorityFileOperations,
      rename: async (oldPath, newPath) => {
        isolatedEntry = newPath;
        await runtime.projectAuthorityFileOperations.rename(oldPath, retired);
        write(oldPath, 'raced replacement');
        await runtime.projectAuthorityFileOperations.rename(oldPath, newPath);
      }
    };
    const authority = new runtime.FileSearchProjectAuthority(operations);
    const binding = await authority.bindWorkspace(runtimeInstanceId, 'workspace-isolation', root);
    const grant = await authority.prepareDelete(
      runtimeInstanceId,
      binding.workspaceId,
      binding.workspaceGeneration,
      'target.txt'
    );

    await assert.rejects(
      authority.commitDelete(
        runtimeInstanceId,
        binding.workspaceId,
        binding.workspaceGeneration,
        grant.grantId,
        'target.txt'
      ),
      expectOnlyPreviewError('PATH_NOT_FOUND')
    );
    assert.equal(readFileSync(target, 'utf8'), 'raced replacement');
    assert.equal(readFileSync(retired, 'utf8'), 'pinned original');
    assert.equal(readFileSync(isolatedEntry, 'utf8'), 'raced replacement');
  });
});

test('Delete final generation fence preserves isolation when a concurrent candidate exists', async () => {
  await withTempDirectory('onlypreview-project-delete-final-fence-', async (root) => {
    const target = write(join(root, 'target.txt'), 'pinned original');
    let isolatedEntry = '';
    let signalIsolated;
    const isolated = new Promise((resolveIsolated) => {
      signalIsolated = resolveIsolated;
    });
    let releaseRename;
    const renameGate = new Promise((resolveRename) => {
      releaseRename = resolveRename;
    });
    let recoveryLinkCount = 0;
    const operations = {
      ...runtime.projectAuthorityFileOperations,
      rename: async (oldPath, newPath) => {
        await runtime.projectAuthorityFileOperations.rename(oldPath, newPath);
        isolatedEntry = newPath;
        write(oldPath, 'concurrent candidate');
        signalIsolated();
        await renameGate;
      },
      link: async (...params) => {
        recoveryLinkCount += 1;
        await runtime.projectAuthorityFileOperations.link(...params);
      }
    };
    const authority = new runtime.FileSearchProjectAuthority(operations);
    const binding = await authority.bindWorkspace(runtimeInstanceId, 'workspace-final-fence', root);
    const grant = await authority.prepareDelete(
      runtimeInstanceId,
      binding.workspaceId,
      binding.workspaceGeneration,
      'target.txt'
    );
    const commit = authority.commitDelete(
      runtimeInstanceId,
      binding.workspaceId,
      binding.workspaceGeneration,
      grant.grantId,
      'target.txt'
    );
    await isolated;
    await authority.revokeWorkspace(binding.workspaceId, binding.workspaceGeneration);
    releaseRename();

    await assert.rejects(commit, expectOnlyPreviewError('WORKSPACE_ACCESS_DENIED'));
    assert.equal(readFileSync(target, 'utf8'), 'concurrent candidate');
    assert.equal(readFileSync(isolatedEntry, 'utf8'), 'pinned original');
    assert.equal(recoveryLinkCount, 1);
  });
});

test('unsupported recovery links retain the isolated entry without large copy fallback', async () => {
  await withTempDirectory('onlypreview-project-delete-no-link-', async (root) => {
    const target = write(join(root, 'target.txt'), 'pinned original');
    const retired = join(root, 'retired-original.txt');
    let isolatedEntry = '';
    const operations = {
      ...runtime.projectAuthorityFileOperations,
      rename: async (oldPath, newPath) => {
        isolatedEntry = newPath;
        await runtime.projectAuthorityFileOperations.rename(oldPath, retired);
        write(oldPath, 'raced replacement');
        await runtime.projectAuthorityFileOperations.rename(oldPath, newPath);
      },
      link: async () => {
        const error = new Error('hard links unavailable');
        error.code = 'ENOTSUP';
        throw error;
      }
    };
    const authority = new runtime.FileSearchProjectAuthority(operations);
    const binding = await authority.bindWorkspace(runtimeInstanceId, 'workspace-no-link', root);
    const grant = await authority.prepareDelete(
      runtimeInstanceId,
      binding.workspaceId,
      binding.workspaceGeneration,
      'target.txt'
    );

    await assert.rejects(
      authority.commitDelete(
        runtimeInstanceId,
        binding.workspaceId,
        binding.workspaceGeneration,
        grant.grantId,
        'target.txt'
      ),
      expectOnlyPreviewError('PATH_NOT_FOUND')
    );
    assert.equal(existsSync(target), false);
    assert.equal(readFileSync(retired, 'utf8'), 'pinned original');
    assert.equal(readFileSync(isolatedEntry, 'utf8'), 'raced replacement');
  });
});

test('unlink failure restores the isolated identity and rmdir failure never changes success', async () => {
  await withTempDirectory('onlypreview-project-delete-cleanup-', async (root) => {
    const first = write(join(root, 'first.txt'), 'first');
    let firstIsolated = '';
    const unlinkFailureOperations = {
      ...runtime.projectAuthorityFileOperations,
      rename: async (oldPath, newPath) => {
        firstIsolated = newPath;
        await runtime.projectAuthorityFileOperations.rename(oldPath, newPath);
      },
      unlink: async (path) => {
        if (path === firstIsolated) {
          const error = new Error('unlink denied');
          error.code = 'EACCES';
          throw error;
        }
        await runtime.projectAuthorityFileOperations.unlink(path);
      }
    };
    const firstAuthority = new runtime.FileSearchProjectAuthority(unlinkFailureOperations);
    const firstBinding = await firstAuthority.bindWorkspace(
      runtimeInstanceId,
      'workspace-unlink-failure',
      root
    );
    const firstGrant = await firstAuthority.prepareDelete(
      runtimeInstanceId,
      firstBinding.workspaceId,
      firstBinding.workspaceGeneration,
      'first.txt'
    );
    await assert.rejects(
      firstAuthority.commitDelete(
        runtimeInstanceId,
        firstBinding.workspaceId,
        firstBinding.workspaceGeneration,
        firstGrant.grantId,
        'first.txt'
      ),
      expectOnlyPreviewError('PATH_PERMISSION_DENIED')
    );
    assert.equal(readFileSync(first, 'utf8'), 'first');
    assert.equal(readFileSync(firstIsolated, 'utf8'), 'first');

    const second = write(join(root, 'second.txt'), 'second');
    let recoveryDirectory = '';
    const rmdirFailureOperations = {
      ...runtime.projectAuthorityFileOperations,
      mkdir: async (path, mode) => {
        recoveryDirectory = path;
        await runtime.projectAuthorityFileOperations.mkdir(path, mode);
      },
      rmdir: async () => {
        const error = new Error('rmdir denied');
        error.code = 'EACCES';
        throw error;
      }
    };
    const secondAuthority = new runtime.FileSearchProjectAuthority(rmdirFailureOperations);
    const secondBinding = await secondAuthority.bindWorkspace(
      runtimeInstanceId,
      'workspace-rmdir-failure',
      root
    );
    const secondGrant = await secondAuthority.prepareDelete(
      runtimeInstanceId,
      secondBinding.workspaceId,
      secondBinding.workspaceGeneration,
      'second.txt'
    );
    await secondAuthority.commitDelete(
      runtimeInstanceId,
      secondBinding.workspaceId,
      secondBinding.workspaceGeneration,
      secondGrant.grantId,
      'second.txt'
    );
    assert.equal(existsSync(second), false);
    assert.equal(existsSync(recoveryDirectory), true);
  });
});

test('cancel, rebind, and dispose close every pinned Delete handle', async () => {
  await withTempDirectory('onlypreview-project-delete-handles-', async (root) => {
    write(join(root, 'target.txt'), 'target');
    let closeCount = 0;
    const operations = {
      ...runtime.projectAuthorityFileOperations,
      open: async (...params) => {
        const handle = await runtime.projectAuthorityFileOperations.open(...params);
        return new Proxy(handle, {
          get(target, property) {
            if (property === 'close') {
              return async () => {
                closeCount += 1;
                return await target.close();
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          }
        });
      }
    };
    const authority = new runtime.FileSearchProjectAuthority(operations);
    const first = await authority.bindWorkspace(runtimeInstanceId, 'workspace-handles-1', root);
    const cancelled = await authority.prepareDelete(
      runtimeInstanceId,
      first.workspaceId,
      first.workspaceGeneration,
      'target.txt'
    );
    await authority.cancelDelete(
      runtimeInstanceId,
      first.workspaceId,
      first.workspaceGeneration,
      cancelled.grantId,
      'target.txt'
    );
    assert.equal(closeCount, 1);

    await authority.prepareDelete(
      runtimeInstanceId,
      first.workspaceId,
      first.workspaceGeneration,
      'target.txt'
    );
    const second = await authority.bindWorkspace(runtimeInstanceId, 'workspace-handles-2', root);
    assert.equal(closeCount, 2);

    await authority.prepareDelete(
      runtimeInstanceId,
      second.workspaceId,
      second.workspaceGeneration,
      'target.txt'
    );
    authority.dispose();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closeCount, 3);
  });
});

test(
  'Delete grant expiry timer actively closes its pinned handle',
  { timeout: 1_000 },
  async () => {
    await withTempDirectory('onlypreview-project-delete-expiry-timer-', async (root) => {
      const target = write(join(root, 'target.txt'), 'target');
      let signalClosed;
      const closed = new Promise((resolveClosed) => {
        signalClosed = resolveClosed;
      });
      const operations = {
        ...runtime.projectAuthorityFileOperations,
        open: async (...params) => {
          const handle = await runtime.projectAuthorityFileOperations.open(...params);
          return new Proxy(handle, {
            get(targetHandle, property) {
              if (property === 'close') {
                return async () => {
                  await targetHandle.close();
                  signalClosed();
                };
              }
              const value = Reflect.get(targetHandle, property, targetHandle);
              return typeof value === 'function' ? value.bind(targetHandle) : value;
            }
          });
        }
      };
      const authority = new runtime.FileSearchProjectAuthority(operations, () => Date.now(), 10);
      const binding = await authority.bindWorkspace(runtimeInstanceId, 'workspace-timer', root);
      const grant = await authority.prepareDelete(
        runtimeInstanceId,
        binding.workspaceId,
        binding.workspaceGeneration,
        'target.txt'
      );
      await closed;
      await assert.rejects(
        authority.commitDelete(
          runtimeInstanceId,
          binding.workspaceId,
          binding.workspaceGeneration,
          grant.grantId,
          'target.txt'
        ),
        expectOnlyPreviewError('INVALID_INPUT')
      );
      assert.equal(existsSync(target), true);
    });
  }
);

test('late item authorization cannot return after a workspace rebind', async () => {
  await withTempDirectory('onlypreview-project-authority-late-', async (root) => {
    const target = write(join(root, 'target.txt'), 'target');
    const canonicalTarget = realpathSync(target);
    let signalStat;
    const statEntered = new Promise((resolveStat) => {
      signalStat = resolveStat;
    });
    let releaseStat;
    const statGate = new Promise((resolveStat) => {
      releaseStat = resolveStat;
    });
    let blocked = false;
    const operations = {
      ...runtime.projectAuthorityFileOperations,
      stat: async (path) => {
        const result = await runtime.projectAuthorityFileOperations.stat(path);
        if (path === canonicalTarget && !blocked) {
          blocked = true;
          signalStat();
          await statGate;
        }
        return result;
      }
    };
    const authority = new runtime.FileSearchProjectAuthority(operations);
    const first = await authority.bindWorkspace(runtimeInstanceId, 'workspace-late-1', root);
    const authorization = authority.authorizeItem(
      runtimeInstanceId,
      first.workspaceId,
      first.workspaceGeneration,
      'target.txt'
    );
    await statEntered;
    const second = await authority.bindWorkspace(runtimeInstanceId, 'workspace-late-2', root);
    releaseStat();

    assert.equal(second.workspaceGeneration, 2);
    await assert.rejects(authorization, expectOnlyPreviewError('WORKSPACE_ACCESS_DENIED'));
  });
});

test('Project authority response parser rejects malformed or path-bearing private envelopes', () => {
  assert.deepEqual(runtime.unwrapOnlyPreviewProjectAuthorityResponse({ ok: true, value: 7 }), 7);
  assert.equal(
    runtime.unwrapOnlyPreviewProjectAuthorityResponse({ ok: true, value: undefined }),
    undefined
  );
  assert.throws(
    () =>
      runtime.unwrapOnlyPreviewProjectAuthorityResponse({
        ok: false,
        error: { code: 'PATH_NOT_FOUND', message: 'The selected Project item is unavailable.' }
      }),
    expectOnlyPreviewError('PATH_NOT_FOUND')
  );
  for (const envelope of [
    { ok: true, value: 7, extra: true },
    { ok: true },
    { ok: false, error: { code: 'HOST_NOT_FOUND', message: 'No host.' } },
    {
      ok: false,
      error: { code: 'PATH_NOT_FOUND', message: '/Users/private/secret.txt was not found.' }
    },
    {
      ok: false,
      error: { code: 'PATH_NOT_FOUND', message: 'Missing.', canonicalPath: '/private' }
    }
  ]) {
    assert.throws(
      () => runtime.unwrapOnlyPreviewProjectAuthorityResponse(envelope),
      (error) => error instanceof runtime.OnlyPreviewProjectAuthorityProtocolError
    );
  }
});

test('Project authority failures remain typed, bounded, and path-free', async () => {
  await withTempDirectory('onlypreview-project-errors-', async (root) => {
    const authority = new runtime.FileSearchProjectAuthority();
    const binding = await authority.bindWorkspace(runtimeInstanceId, 'workspace-errors', root);
    await assert.rejects(
      authority.authorizeItem(
        runtimeInstanceId,
        binding.workspaceId,
        binding.workspaceGeneration,
        'missing/private.txt'
      ),
      (error) => {
        assert.equal(error.code, 'PATH_NOT_FOUND');
        assert.ok(error.message.length < 160);
        assert.equal(error.message.includes(root), false);
        return true;
      }
    );
  });
});

test('expired Delete grants and disposed runtime authority cannot be reused', async () => {
  await withTempDirectory('onlypreview-project-expiry-', async (root) => {
    const target = write(join(root, 'expiring.txt'), 'keep');
    const authority = new runtime.FileSearchProjectAuthority();
    const binding = await authority.bindWorkspace(runtimeInstanceId, 'workspace-expiry', root);
    const grant = await authority.prepareDelete(
      runtimeInstanceId,
      binding.workspaceId,
      binding.workspaceGeneration,
      'expiring.txt'
    );
    const originalNow = Date.now;
    const preparedAt = originalNow();
    Date.now = () => preparedAt + 60_001;
    try {
      await assert.rejects(
        authority.commitDelete(
          runtimeInstanceId,
          binding.workspaceId,
          binding.workspaceGeneration,
          grant.grantId,
          'expiring.txt'
        ),
        expectOnlyPreviewError('INVALID_INPUT')
      );
    } finally {
      Date.now = originalNow;
    }
    assert.equal(existsSync(target), true);

    authority.dispose();
    await assert.rejects(
      authority.authorizeItem(
        runtimeInstanceId,
        binding.workspaceId,
        binding.workspaceGeneration,
        'expiring.txt'
      ),
      expectOnlyPreviewError('WORKSPACE_ACCESS_DENIED')
    );
  });
});

test('Main retains only a host/workspace/generation ref for Project authority dispatch', () => {
  const hosts = new runtime.OnlyPreviewHostRegistry();
  const workspaces = new runtime.OnlyPreviewWorkspaceRegistry(hosts);
  const hostA = hosts.issue('standalone', 'content');
  const hostB = hosts.issue('standalone', 'content');
  const workspace = workspaces.registerValidatedTarget(hostA.hostToken, {
    rootRealPath: '/tmp/project-authority-main-ref',
    rootName: 'project-authority-main-ref',
    displayPath: '/tmp/project-authority-main-ref'
  });
  assert.throws(
    () => workspaces.getProjectAuthorityRootRef(hostA.hostToken, workspace.workspaceId),
    expectOnlyPreviewError('WORKSPACE_ACCESS_DENIED')
  );
  workspaces.bindProjectAuthority(hostA.hostToken, workspace.workspaceId, 7);
  const ref = workspaces.getProjectAuthorityItemRef(hostA.hostToken, {
    workspaceId: workspace.workspaceId,
    relativePath: 'src/main.ts'
  });
  assert.equal(ref.workspaceGeneration, 7);
  assert.equal(ref.relativePath, 'src/main.ts');
  assert.equal(Object.hasOwn(ref, 'rootPath'), false);
  assert.throws(
    () =>
      workspaces.getProjectAuthorityItemRef(hostB.hostToken, {
        workspaceId: workspace.workspaceId,
        relativePath: 'src/main.ts'
      }),
    expectOnlyPreviewError('WORKSPACE_ACCESS_DENIED')
  );
  hosts.revoke(hostA.hostToken);
  assert.throws(
    () =>
      workspaces.getProjectAuthorityItemRef(hostA.hostToken, {
        workspaceId: workspace.workspaceId,
        relativePath: 'src/main.ts'
      }),
    expectOnlyPreviewError('HOST_NOT_FOUND')
  );
});

const recoveryEntries = (root) =>
  readdirSync(root).filter((name) => name.startsWith('.bitterless-delete-recovery-'));

test('a folder is deleted with everything inside it and leaves no recovery entry', async () => {
  await withTempDirectory('onlypreview-project-delete-folder-', async (root) => {
    mkdirSync(join(root, 'out-yes', 'deep'), { recursive: true });
    write(join(root, 'out-yes', 'notes.txt'), 'notes');
    write(join(root, 'out-yes', 'deep', 'inner.txt'), 'inner');
    write(join(root, 'keep.txt'), 'keep');
    const authority = new runtime.FileSearchProjectAuthority();
    const binding = await authority.bindWorkspace(runtimeInstanceId, 'workspace-folder', root);

    const grant = await authority.prepareDelete(
      runtimeInstanceId,
      binding.workspaceId,
      binding.workspaceGeneration,
      'out-yes'
    );
    const result = await authority.commitDelete(
      runtimeInstanceId,
      binding.workspaceId,
      binding.workspaceGeneration,
      grant.grantId,
      'out-yes'
    );

    assert.equal(result.relativePath, 'out-yes');
    assert.equal(existsSync(join(root, 'out-yes')), false);
    assert.equal(existsSync(join(root, 'keep.txt')), true, 'a sibling is untouched');
    // The isolate rename moves the folder into a private directory before the recursive removal.
    // That directory is ours and must never be left in the owner's Project.
    assert.deepEqual(recoveryEntries(root), []);
  });
});

test('a folder delete that fails after isolation restores it and cleans up after itself', async () => {
  await withTempDirectory('onlypreview-project-delete-folder-fail-', async (root) => {
    mkdirSync(join(root, 'src'));
    write(join(root, 'src', 'main.ts'), 'export {};');
    // The failure has to land after the isolate rename, which is the only point where a recovery
    // directory exists at all.
    const operations = {
      ...runtime.projectAuthorityFileOperations,
      removeTree: async () => {
        throw new Error('refused');
      }
    };
    const authority = new runtime.FileSearchProjectAuthority(operations);
    const binding = await authority.bindWorkspace(runtimeInstanceId, 'workspace-fail', root);
    const grant = await authority.prepareDelete(
      runtimeInstanceId,
      binding.workspaceId,
      binding.workspaceGeneration,
      'src'
    );

    await assert.rejects(
      authority.commitDelete(
        runtimeInstanceId,
        binding.workspaceId,
        binding.workspaceGeneration,
        grant.grantId,
        'src'
      ),
      expectOnlyPreviewError('OPERATION_FAILED')
    );
    assert.equal(existsSync(join(root, 'src', 'main.ts')), true, 'nothing was lost');
    assert.deepEqual(recoveryEntries(root), []);
  });
});
