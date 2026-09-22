/* eslint-disable @typescript-eslint/explicit-function-return-type */
//
// 删除任务日志:让"删文件"和"清索引"成为一个可以跨重启续做的整体。
// 设计见 `areas/agent-runtime/preview/index-solution.html` #2 / #4 / #6。
//
// 这些用例逐条对应 2026-09-21 review 指出的缺陷(D3/D4/D6/D9/D10),每一条都能在修复前失败。
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  advanceDeleteTaskToIndex,
  beginDeleteTask,
  clearDeleteTask,
  deleteJournalPath,
  readDeleteJournal
} from '../../src/preload/onlypreview/search/core/delete-journal.mjs';

const withTempDirectory = async (callback) => {
  const path = await mkdtemp(join(tmpdir(), 'onlypreview-delete-journal-'));
  try {
    return await callback(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
};

const openTask = (overrides = {}) => ({
  workspaceId: 'workspace-a',
  rootPath: '/workspaces/a',
  relativePaths: ['docs/gone.md'],
  ...overrides
});

test('two workspaces in one index directory keep separate journals', async () => {
  // 所有工作区的库都躺在同一个目录里,只靠文件名区分。日志早先按 `dirname` 拼名字,于是全部
  // 工作区共用一份 —— 两个引擎同时活着是设计内的常态,它们在不同的库路径上真并行,对同一个
  // 文件做无保护的读-改-写,后写的把先写的整条任务吞掉。
  await withTempDirectory(async (temp) => {
    const dbA = join(temp, 'aaaa.sqlite');
    const dbB = join(temp, 'bbbb.sqlite');
    assert.notEqual(deleteJournalPath(dbA), deleteJournalPath(dbB));

    await Promise.all([
      beginDeleteTask(dbA, openTask({ workspaceId: 'workspace-a', relativePaths: ['a.md'] })),
      beginDeleteTask(dbB, openTask({ workspaceId: 'workspace-b', relativePaths: ['b.md'] }))
    ]);

    assert.deepEqual(
      (await readDeleteJournal(dbA)).map((task) => task.relativePaths),
      [['a.md']],
      'workspace A lost its task to a concurrent write from workspace B'
    );
    assert.deepEqual(
      (await readDeleteJournal(dbB)).map((task) => task.relativePaths),
      [['b.md']]
    );
  });
});

test('an unreadable journal throws instead of reading as "no debt"', async () => {
  // 把读失败当成空表,下一步的写就会把既有欠账整个覆盖掉;`advanceDeleteTaskToIndex` 更会算出
  // 空表进而删掉整份日志 —— 恰好发生在文件刚被删、只欠索引清理的那一刻。
  await withTempDirectory(async (temp) => {
    const db = join(temp, 'index.sqlite');
    const failing = {
      readFile: async () => {
        throw Object.assign(new Error('too many open files'), { code: 'EMFILE' });
      }
    };
    await assert.rejects(() => readDeleteJournal(db, failing), /EMFILE|too many open files/u);
  });
});

test('a missing journal still reads as "no debt"', async () => {
  await withTempDirectory(async (temp) => {
    assert.deepEqual(await readDeleteJournal(join(temp, 'index.sqlite')), []);
  });
});

test('advancing to the index phase keeps only paths the task actually covered', async () => {
  // `removedPaths` 早先是整个替换 `relativePaths`,于是一个调用方的 bug 就能把从未授权过的
  // 路径写进欠账,恢复时会把它从索引里抹掉。
  await withTempDirectory(async (temp) => {
    const db = join(temp, 'index.sqlite');
    const task = await beginDeleteTask(db, openTask({ relativePaths: ['keep.md', 'gone.md'] }));
    await advanceDeleteTaskToIndex(db, {
      taskId: task.taskId,
      removedPaths: ['gone.md', 'never-authorized.md']
    });
    const [stored] = await readDeleteJournal(db);
    assert.deepEqual(stored.relativePaths, ['gone.md']);
    assert.equal(stored.phase, 'index');
  });
});

test('advancing an unknown task id throws rather than silently succeeding', async () => {
  // 静默成功的话,调用方会接着去清索引 —— 此刻没有任何持久记录,崩在那里欠账就永久丢了。
  await withTempDirectory(async (temp) => {
    const db = join(temp, 'index.sqlite');
    await beginDeleteTask(db, openTask());
    await assert.rejects(
      () => advanceDeleteTaskToIndex(db, { taskId: 'not-a-real-task', removedPaths: ['x.md'] }),
      /unknown/iu
    );
  });
});

test('nothing was removed, so the task is dropped instead of becoming a phantom debt', async () => {
  await withTempDirectory(async (temp) => {
    const db = join(temp, 'index.sqlite');
    const task = await beginDeleteTask(db, openTask());
    await advanceDeleteTaskToIndex(db, { taskId: task.taskId, removedPaths: [] });
    assert.deepEqual(await readDeleteJournal(db), []);
  });
});

test('an overflowing journal keeps the newest tasks, not the oldest', async () => {
  // 读端早先截头(`slice(0, MAX_TASKS)`)而写端追加到尾部,于是一旦攒够上限,**刚开的**那条
  // 任务对之后每一次读都不可见 —— 它的索引清理永远不会发生。
  await withTempDirectory(async (temp) => {
    const db = join(temp, 'index.sqlite');
    const tasks = [];
    for (let index = 0; index < 70; index += 1) {
      tasks.push({
        taskId: `task-${index}`,
        workspaceId: 'workspace-a',
        rootPath: '/workspaces/a',
        relativePaths: [`file-${index}.md`],
        phase: 'files',
        createdAt: index
      });
    }
    await writeFile(deleteJournalPath(db), JSON.stringify({ version: 1, tasks }), 'utf8');
    const read = await readDeleteJournal(db);
    assert.equal(read.length, 64);
    assert.equal(read.at(-1).taskId, 'task-69', 'the newest task must survive truncation');
  });
});

test('the journal is written durably and leaves no staging file behind', async () => {
  await withTempDirectory(async (temp) => {
    const db = join(temp, 'index.sqlite');
    await beginDeleteTask(db, openTask());
    const written = JSON.parse(await readFile(deleteJournalPath(db), 'utf8'));
    assert.equal(written.version, 1);
    assert.equal(written.tasks.length, 1);
    await assert.rejects(() => stat(`${deleteJournalPath(db)}.tmp`), { code: 'ENOENT' });
  });
});

test('clearing the last task removes the journal file', async () => {
  await withTempDirectory(async (temp) => {
    const db = join(temp, 'index.sqlite');
    const task = await beginDeleteTask(db, openTask());
    await clearDeleteTask(db, task.taskId);
    await assert.rejects(() => stat(deleteJournalPath(db)), { code: 'ENOENT' });
  });
});
