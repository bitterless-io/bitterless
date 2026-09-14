import type { WebContents } from 'electron'

/** A real local document starts Chromium's target without issuing any website request. */
export const prepareBrowserDocument = (wc: WebContents): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    wc.loadURL('about:blank'),
    new Promise<void>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Browser document preparation timed out.')), 5000)
    })
  ]).finally(() => { if (timer) clearTimeout(timer) })
}
