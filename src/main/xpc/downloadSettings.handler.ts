// PAIRED FILE — `micromeet-cowork` has the same class under the same name; only the settings
// service differs (`CoachSettingsService(maestroDataRoot())` here, `CoworkSettingsService(userData)`
// there), because that is where each app already keeps its main-process settings. The class name is
// identical on purpose: the renderer emitter string is then the same one in both repos.
//
// 下载目录设置(docs/features/browser-downloads.md #1.1)。
//
// Registration is a pure construction side effect: the module-scope `new` registers
// `xpc:DownloadSettingsHandler/<method>`.
import { dialog, shell } from 'electron';
import { XpcMainHandler } from 'electron-xpc/main';
import { maestroDataRoot } from '@maestro-main/data/maestroDataRoot';
import { CoachSettingsService } from '@maestro-main/settings/coachSettings.service';
import { downloadDirAvailable, systemDownloadDir } from '@main/net/downloadManager';
import type { DownloadSettingsApi, DownloadSettingsSnapshot } from '@shared/downloads/downloadSettings.api';

let service: CoachSettingsService | null = null;
const settings = (): CoachSettingsService => (service ??= new CoachSettingsService(maestroDataRoot()));

/**
 * `configured` 与 `effective` 是**两件事**,界面两个都要:前者是"人选过什么"(可能是空 =
 * 没选过),后者是"这一刻真的会落在哪"。只给后者的话,人换了系统下载目录之后界面会把
 * 旧的系统路径显示成"我选的",那是假的。
 */
const snapshot = (): DownloadSettingsSnapshot => {
  const system = systemDownloadDir();
  const configured = settings().read().downloadDir || '';
  // 没配过时不去探磁盘:系统下载目录由 OS 保证存在,探它只会在异常环境里给出一个没人能修的红字。
  const available = configured ? downloadDirAvailable(configured) : true;
  return {
    configured,
    system,
    effective: configured && available ? configured : system,
    unavailable: Boolean(configured) && !available
  };
};

export class DownloadSettingsHandler extends XpcMainHandler implements DownloadSettingsApi {
  async state(): Promise<DownloadSettingsSnapshot> {
    return snapshot();
  }

  async choose(): Promise<DownloadSettingsSnapshot> {
    const current = snapshot();
    const picked = await dialog.showOpenDialog({
      // `createDirectory`:人常常是想新建一个「下载/发票」这样的目录,不给的话他得先去访达建。
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: current.effective
    });
    // **取消 = 什么都不改。** 把当前状态原样返回,渲染端不必区分"取消"和"失败"。
    if (picked.canceled || !picked.filePaths[0]) return current;
    settings().save({ downloadDir: picked.filePaths[0] });
    return snapshot();
  }

  async reset(): Promise<DownloadSettingsSnapshot> {
    // 空串经 `normalizeDownloadDir` 就是"没设过" —— 于是键根本不落盘,而不是落一个空值。
    settings().save({ downloadDir: '' });
    return snapshot();
  }

  async reveal(): Promise<void> {
    // 打开**真正**会用的那个目录:配的目录不可用时,人该看到文件实际去的地方。
    await shell.openPath(snapshot().effective);
  }
}

export const downloadSettingsHandler = new DownloadSettingsHandler();
