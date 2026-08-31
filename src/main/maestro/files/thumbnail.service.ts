import { nativeImage } from 'electron'
import { extname } from 'node:path'
import { stat } from 'node:fs/promises'

const THUMBNAIL_MAX_SIDE_PX = 104
const THUMBNAIL_MAX_SOURCE_BYTES = 40 * 1024 * 1024
const THUMBNAIL_MAX_DATA_URL_CHARS = 400_000

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'ico',
  'tif',
  'tiff'
])

export interface ThumbnailResult {
  ok: boolean
  dataUrl?: string
  width?: number
  height?: number
  error?: string
}

export const fileThumbnail = async (path: string): Promise<ThumbnailResult> => {
  const extension = extname(path).replace(/^\./, '').toLowerCase()
  if (!IMAGE_EXTENSIONS.has(extension)) return { ok: false, error: 'not-an-image' }

  const stats = await stat(path).catch(() => null)
  if (!stats?.isFile()) return { ok: false, error: 'not-found' }
  if (stats.size > THUMBNAIL_MAX_SOURCE_BYTES) return { ok: false, error: 'too-large' }

  const image = nativeImage.createFromPath(path)
  if (image.isEmpty()) return { ok: false, error: 'undecodable' }
  const { width, height } = image.getSize()
  const longest = Math.max(width, height)
  const scaled =
    longest <= THUMBNAIL_MAX_SIDE_PX
      ? image
      : image.resize(
          width >= height
            ? { width: THUMBNAIL_MAX_SIDE_PX, quality: 'good' }
            : { height: THUMBNAIL_MAX_SIDE_PX, quality: 'good' }
        )
  const dataUrl = scaled.toDataURL()
  if (!dataUrl || dataUrl.length > THUMBNAIL_MAX_DATA_URL_CHARS) {
    return { ok: false, error: 'thumbnail-too-large' }
  }
  return { ok: true, dataUrl, width, height }
}
