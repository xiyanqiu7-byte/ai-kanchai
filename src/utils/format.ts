export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const totalMs = Math.round(seconds * 1000)
  const ms = totalMs % 1000
  const totalSec = Math.floor(totalMs / 1000)
  const s = totalSec % 60
  const totalMin = Math.floor(totalSec / 60)
  const m = totalMin % 60
  const h = Math.floor(totalMin / 60)
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.000'
  const ms = Math.round((seconds % 1) * 1000)
  const total = Math.floor(seconds)
  const s = total % 60
  const m = Math.floor(total / 60)
  return `${m}:${pad(s, 2)}.${pad(ms, 3)}`
}

function pad(n: number, w: number) {
  return String(n).padStart(w, '0')
}

export function buildFilename(opts: {
  episode: string
  clipNo: number
  dayNight: string
  look: string
  summary: string
}): string {
  const ep = (opts.episode || '00').trim()
  const no = String(opts.clipNo).padStart(2, '0')
  const dn = opts.dayNight || ''
  const look = (opts.look || '未命名造型').trim()
  const summary = (opts.summary || '未命名片段').trim()
  const raw = `${ep}-${no}${dn}·${look}·${summary}.mp4`
  return raw.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
}

export function parsePathName(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || filePath
}
