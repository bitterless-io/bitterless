/**
 * 把聊天正文里一个链接的 href 解回**本地绝对路径**;不是本地文件就返回 null。
 *
 * 从 `MessageItem.vue` 里抽出来的,因为右键菜单(`fileLinkMenu.store.ts`)要用同一套判定。
 * **不要抄第二份** —— 编码与解码分开住就会悄悄漂移,cowork 那边的
 * `shared/replyFileLink.ts` 顶上记着这条:一个含字面 `%28` 的路径曾经解成 `(` 然后什么也打不开。
 */
// Absolute local links emitted by file tools reveal their target in Finder/Explorer. Network links
// remain normal Markdown links; the chat renderer must never navigate itself to a local path.
export const RAW_LOCAL_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/
export const localPathFromHref = (href: string): string | null => {
  if (/^file:/i.test(href)) {
    try {
      const parsed = new URL(href)
      if (parsed.protocol !== 'file:') return null
      let path = decodeURIComponent(parsed.pathname)
      if (parsed.hostname && parsed.hostname.toLowerCase() !== 'localhost') {
        path = `//${parsed.hostname}${path}`
      } else if (/^\/[A-Za-z]:[\\/]/.test(path)) {
        // WHATWG file URLs keep a leading slash before a Windows drive letter.
        path = path.slice(1)
      }
      return path || null
    } catch {
      return null
    }
  }
  if (!RAW_LOCAL_PATH.test(href)) return null
  try {
    return decodeURIComponent(href)
  } catch {
    return null
  }
}
