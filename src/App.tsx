import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { v4 as uuid } from 'uuid'
import './styles/app.css'
import type { AnalyzeProgress, CharacterProfile, DayNight, Segment, VideoInfo } from './types'
import { buildFilename, formatDuration, formatTimecode, parsePathName } from './utils/format'
import { useShortcuts } from './hooks/useShortcuts'

const hasDesktopApi = typeof window !== 'undefined' && !!window.kanchai

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [video, setVideo] = useState<VideoInfo | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const [episode, setEpisode] = useState('07')
  const [character, setCharacter] = useState<CharacterProfile | null>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [inPoint, setInPoint] = useState(0)
  const [outPoint, setOutPoint] = useState(0)
  const [analyze, setAnalyze] = useState<AnalyzeProgress>({ status: 'idle', percent: 0 })
  const [statusMsg, setStatusMsg] = useState('拖入视频开始')
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [detectedFaces, setDetectedFaces] = useState<{ box: number[]; score: number }[]>([])
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 })
  const [framePath, setFramePath] = useState<string | null>(null)
  const [frameUrl, setFrameUrl] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const accepted = segments.filter((s) => s.accepted)

  const loadVideoPath = useCallback(async (filePath: string) => {
    if (!hasDesktopApi) {
      setStatusMsg('请在 Electron 桌面端中打开')
      return
    }
    const mediaUrl = await window.kanchai.toMediaUrl(filePath)
    let duration = 0
    let fps = 24
    let width = 0
    let height = 0
    try {
      const info = await window.kanchai.analyzer('GET', `/probe?path=${encodeURIComponent(filePath)}`)
      duration = info.duration || 0
      fps = info.fps || 24
      width = info.width || 0
      height = info.height || 0
    } catch (err) {
      console.warn(err)
    }
    setVideo({
      path: filePath,
      mediaUrl,
      name: parsePathName(filePath),
      duration,
      fps,
      width,
      height,
    })
    setSegments([])
    setActiveId(null)
    setCurrentTime(0)
    setInPoint(0)
    setOutPoint(0)
    setStatusMsg(`已载入：${parsePathName(filePath)}`)
  }, [])

  const openVideo = useCallback(async () => {
    if (!hasDesktopApi) return
    const p = await window.kanchai.openVideo()
    if (p) await loadVideoPath(p)
  }, [loadVideoPath])

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
    }
    const onDrop = async (e: DragEvent) => {
      e.preventDefault()
      if (!hasDesktopApi) return
      const file = e.dataTransfer?.files?.[0]
      if (!file) return
      const filePath = window.kanchai.getPathForFile(file)
      if (filePath) await loadVideoPath(filePath)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [loadVideoPath])

  const seek = useCallback((t: number) => {
    const v = videoRef.current
    if (!v) return
    const max = video?.duration || v.duration || 0
    const next = Math.min(Math.max(0, t), max || t)
    v.currentTime = next
    setCurrentTime(next)
  }, [video])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      void v.play()
      setPlaying(true)
    } else {
      v.pause()
      setPlaying(false)
    }
  }, [])

  const stepFrame = useCallback((dir: 1 | -1) => {
    const fps = video?.fps || 24
    seek(currentTime + dir / fps)
  }, [currentTime, seek, video])

  const bumpRate = useCallback((dir: 1 | -1) => {
    const steps = [0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8]
    const idx = steps.findIndex((s) => s >= rate - 1e-6)
    const next = steps[Math.min(steps.length - 1, Math.max(0, (idx < 0 ? 2 : idx) + dir))]
    setRate(next)
    if (videoRef.current) videoRef.current.playbackRate = next
  }, [rate])

  const selectSegment = useCallback((seg: Segment) => {
    setActiveId(seg.id)
    setInPoint(seg.start)
    setOutPoint(seg.end)
    seek(seg.start)
  }, [seek])

  const updateActiveBounds = useCallback((start: number, end: number) => {
    if (!activeId) return
    setSegments((prev) =>
      prev.map((s) =>
        s.id === activeId
          ? { ...s, start, end, duration: Math.max(0, end - start) }
          : s,
      ),
    )
    setInPoint(start)
    setOutPoint(end)
  }, [activeId])

  const markIn = useCallback(() => {
    const start = currentTime
    const end = Math.max(outPoint, start + 0.05)
    setInPoint(start)
    setOutPoint(end)
    if (activeId) updateActiveBounds(start, end)
  }, [activeId, currentTime, outPoint, updateActiveBounds])

  const markOut = useCallback(() => {
    const end = Math.max(currentTime, inPoint + 0.05)
    setOutPoint(end)
    if (activeId) updateActiveBounds(inPoint, end)
  }, [activeId, currentTime, inPoint, updateActiveBounds])

  const addManualSegment = useCallback(() => {
    const start = inPoint
    const end = Math.max(outPoint, start + 0.05)
    const clipNo = segments.filter((s) => s.accepted).length + 1
    const seg: Segment = {
      id: uuid(),
      start,
      end,
      duration: end - start,
      accepted: true,
      episode,
      clipNo,
      dayNight: '日',
      look: character?.lookLabel || character?.name || '',
      summary: '',
      source: 'manual',
    }
    setSegments((prev) => [...prev, seg])
    setActiveId(seg.id)
  }, [character, episode, inPoint, outPoint, segments])

  const deleteSegment = useCallback((id: string | null) => {
    if (!id) return
    setSegments((prev) => prev.filter((s) => s.id !== id))
    setActiveId((cur) => (cur === id ? null : cur))
  }, [])

  const toggleAccept = useCallback((id: string) => {
    setSegments((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, accepted: !s.accepted } : s))
      let n = 1
      return next.map((s) => (s.accepted ? { ...s, clipNo: n++ } : s))
    })
  }, [])

  const captureAndDetectFaces = useCallback(async () => {
    const v = videoRef.current
    if (!v || !hasDesktopApi) return
    v.pause()
    setPlaying(false)
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(v, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    setFrameUrl(dataUrl)
    setFrameSize({ w: canvas.width, h: canvas.height })
    const frameFile = await window.kanchai.saveFrame(dataUrl, `enroll-${Date.now()}.jpg`)
    setFramePath(frameFile)
    setStatusMsg('正在检测人脸…')
    try {
      const res = await window.kanchai.analyzer('POST', '/faces/detect', { image_path: frameFile })
      setDetectedFaces(res.faces || [])
      setEnrollOpen(true)
      setStatusMsg(res.faces?.length ? `检测到 ${res.faces.length} 张人脸，点击选中建档` : '未检测到人脸')
    } catch (err) {
      setStatusMsg(`人脸检测失败：${(err as Error).message}`)
    }
  }, [])

  const enrollFace = useCallback(async (box?: number[]) => {
    if (!framePath || !hasDesktopApi) return
    try {
      const res = await window.kanchai.analyzer('POST', '/faces/enroll', {
        image_path: framePath,
        box: box || null,
      })
      let previewDataUrl: string | undefined
      if (frameUrl && box) {
        // crop from frameUrl for UI preview
        const img = new Image()
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject()
          img.src = frameUrl
        })
        const [x, y, w, h] = box
        const pad = 0.25
        const px = Math.floor(w * pad)
        const py = Math.floor(h * pad)
        const x1 = Math.max(0, x - px)
        const y1 = Math.max(0, y - py)
        const x2 = Math.min(img.width, x + w + px)
        const y2 = Math.min(img.height, y + h + py)
        const c = document.createElement('canvas')
        c.width = Math.max(1, x2 - x1)
        c.height = Math.max(1, y2 - y1)
        const cx = c.getContext('2d')
        cx?.drawImage(img, x1, y1, c.width, c.height, 0, 0, c.width, c.height)
        previewDataUrl = c.toDataURL('image/jpeg', 0.9)
      }
      setCharacter({
        id: uuid(),
        name: character?.name || '角色A',
        lookLabel: character?.lookLabel || '默认造型',
        embedding: res.embedding,
        previewDataUrl,
      })
      setEnrollOpen(false)
      setStatusMsg('角色已建档，可开始 AI 砍柴')
    } catch (err) {
      setStatusMsg(`建档失败：${(err as Error).message}`)
    }
  }, [character, framePath, frameUrl])

  const runAnalyze = useCallback(async () => {
    if (!video || !character || !hasDesktopApi) return
    setAnalyze({ status: 'running', percent: 0, stage: 'queued' })
    setStatusMsg('AI 分析中…')
    try {
      const { job_id } = await window.kanchai.analyzer('POST', '/analyze', {
        video_path: video.path,
        embeddings: [character.embedding],
        buffer_sec: 0.4,
        match_threshold: 0.35,
        merge_gap_sec: 1.0,
      })
      const poll = async () => {
        const job = await window.kanchai.analyzer('GET', `/analyze/${job_id}`)
        setAnalyze({
          status: job.status,
          percent: job.percent || 0,
          stage: job.stage,
          error: job.error,
        })
        if (job.status === 'running') {
          setTimeout(poll, 600)
          return
        }
        if (job.status === 'error') {
          setStatusMsg(`分析失败：${job.error}`)
          return
        }
        const list: Segment[] = (job.result?.segments || []).map((s: any, i: number) => ({
          id: s.id || uuid(),
          start: s.start,
          end: s.end,
          duration: s.duration ?? s.end - s.start,
          score: s.score,
          source: s.source || 'face_match',
          accepted: true,
          episode,
          clipNo: i + 1,
          dayNight: '日' as DayNight,
          look: character.lookLabel || character.name,
          summary: '',
        }))
        setSegments(list)
        if (list[0]) selectSegment(list[0])
        setStatusMsg(`分析完成：${list.length} 个候选片段`)
      }
      void poll()
    } catch (err) {
      setAnalyze({ status: 'error', percent: 0, error: (err as Error).message })
      setStatusMsg(`分析失败：${(err as Error).message}`)
    }
  }, [character, episode, selectSegment, video])

  const exportAccepted = useCallback(async () => {
    if (!video || !hasDesktopApi || accepted.length === 0) return
    const dir = await window.kanchai.openDirectory()
    if (!dir) return
    setExporting(true)
    setStatusMsg('正在导出…')
    try {
      const payload = {
        video_path: video.path,
        output_dir: dir,
        segments: accepted.map((s) => ({
          id: s.id,
          start: s.start,
          end: s.end,
          filename: buildFilename({ ...s, episode }),
        })),
      }
      const res = await window.kanchai.analyzer('POST', '/export', payload)
      const failed = (res.results || []).filter((r: any) => !r.ok)
      if (failed.length) {
        setStatusMsg(`导出完成，但有 ${failed.length} 个失败`)
      } else {
        setStatusMsg(`已导出 ${accepted.length} 个片段到 ${dir}`)
      }
    } catch (err) {
      setStatusMsg(`导出失败：${(err as Error).message}`)
    } finally {
      setExporting(false)
    }
  }, [accepted, episode, video])

  const patchSegment = useCallback((id: string, patch: Partial<Segment>) => {
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }, [])

  const shortcutMap = useMemo(
    () => ({
      Space: () => togglePlay(),
      K: () => togglePlay(),
      J: () => bumpRate(-1),
      L: () => bumpRate(1),
      ',': () => stepFrame(-1),
      '.': () => stepFrame(1),
      ArrowLeft: () => seek(currentTime - 1),
      ArrowRight: () => seek(currentTime + 1),
      I: () => markIn(),
      O: () => markOut(),
      Backspace: () => deleteSegment(activeId),
      '+': () => addManualSegment(),
      '=': () => addManualSegment(),
      E: () => void captureAndDetectFaces(),
      A: () => void runAnalyze(),
    }),
    [
      activeId,
      addManualSegment,
      bumpRate,
      captureAndDetectFaces,
      currentTime,
      deleteSegment,
      markIn,
      markOut,
      runAnalyze,
      seek,
      stepFrame,
      togglePlay,
    ],
  )
  useShortcuts(shortcutMap)

  const onTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!video?.duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    seek(ratio * video.duration)
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          AI<span>砍柴</span>
        </div>
        <button className="btn" onClick={() => void openVideo()}>
          打开视频
        </button>
        <label>
          集数{' '}
          <input
            type="text"
            value={episode}
            onChange={(e) => setEpisode(e.target.value)}
            title="用于文件名"
          />
        </label>
        <div className="spacer" />
        <span className="status-pill">{statusMsg}</span>
      </header>

      <div className="main">
        <section className="stage">
          <div className="player-wrap">
            {video ? (
              <video
                ref={videoRef}
                src={video.mediaUrl}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onLoadedMetadata={(e) => {
                  if (video && !video.duration) {
                    setVideo({ ...video, duration: e.currentTarget.duration })
                  }
                }}
              />
            ) : (
              <div className="drop-hint">
                <strong>拖放文件到此处</strong>
                <div>或点击左上角打开视频</div>
                <div>E 建角色 · A 开始分析 · I/O 微调 · 空格播放</div>
              </div>
            )}
          </div>

          <div className="timeline-panel">
            <div className="timeline-track" onClick={onTimelineClick}>
              {video?.duration
                ? segments.map((s) => (
                    <div
                      key={s.id}
                      className={`timeline-seg ${s.accepted ? 'accepted' : ''}`}
                      style={{
                        left: `${(s.start / video.duration) * 100}%`,
                        width: `${((s.end - s.start) / video.duration) * 100}%`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        selectSegment(s)
                      }}
                    />
                  ))
                : null}
              {video?.duration ? (
                <div
                  className="timeline-playhead"
                  style={{ left: `${(currentTime / video.duration) * 100}%` }}
                />
              ) : null}
            </div>

            <div className="controls">
              <button className="btn" onClick={() => seek(0)}>
                ⏮
              </button>
              <button className="btn" onClick={() => stepFrame(-1)}>
                ‹
              </button>
              <button className="btn btn-primary" onClick={togglePlay}>
                {playing ? '暂停' : '播放'}
              </button>
              <button className="btn" onClick={() => stepFrame(1)}>
                ›
              </button>
              <span className="timecode">{formatTimecode(currentTime)}</span>
              <span className="timecode" style={{ opacity: 0.6 }}>
                / {formatTimecode(video?.duration || 0)}
              </span>
              <button className="btn" onClick={() => bumpRate(-1)}>
                J
              </button>
              <span className="timecode">{rate}x</span>
              <button className="btn" onClick={() => bumpRate(1)}>
                L
              </button>
              <div className="io-box">
                <span>I</span>
                <input
                  value={formatTimecode(inPoint)}
                  onChange={(e) => {
                    /* display only for MVP */
                    void e
                  }}
                  readOnly
                />
                <span>O</span>
                <input value={formatTimecode(outPoint)} readOnly />
              </div>
              <button className="btn" onClick={markIn}>
                设入点 I
              </button>
              <button className="btn" onClick={markOut}>
                设出点 O
              </button>
              <button className="btn" onClick={addManualSegment}>
                + 片段
              </button>
            </div>
          </div>
        </section>

        <aside className="side">
          <div className="side-section">
            <h3>角色</h3>
            <div className="character-row">
              {character?.previewDataUrl ? (
                <img src={character.previewDataUrl} alt="角色" />
              ) : (
                <div style={{ width: 48, height: 48, borderRadius: 8, background: '#000', border: '1px solid #2c3038' }} />
              )}
              <div className="meta">
                <input
                  placeholder="角色名"
                  value={character?.name || ''}
                  onChange={(e) =>
                    setCharacter((c) =>
                      c ? { ...c, name: e.target.value } : c,
                    )
                  }
                  disabled={!character}
                />
                <input
                  placeholder="造型（写入文件名）"
                  value={character?.lookLabel || ''}
                  onChange={(e) =>
                    setCharacter((c) =>
                      c ? { ...c, lookLabel: e.target.value } : c,
                    )
                  }
                  disabled={!character}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn" disabled={!video} onClick={() => void captureAndDetectFaces()}>
                从当前帧建档 (E)
              </button>
              <button
                className="btn btn-primary"
                disabled={!video || !character || analyze.status === 'running'}
                onClick={() => void runAnalyze()}
              >
                AI 分析 (A)
              </button>
            </div>
            {analyze.status === 'running' ? (
              <div className="progress-bar">
                <div style={{ width: `${analyze.percent}%` }} />
              </div>
            ) : null}
          </div>

          <div className="side-section" style={{ borderBottom: 'none', paddingBottom: 4 }}>
            <h3>待导出的片段 ({accepted.length}/{segments.length})</h3>
          </div>

          <div className="segment-list">
            {segments.length === 0 ? (
              <div className="hint-row" style={{ padding: 8 }}>
                AI 候选或手动添加的片段会显示在这里
              </div>
            ) : (
              segments.map((s) => (
                <div
                  key={s.id}
                  className={`segment-card ${activeId === s.id ? 'active' : ''} ${s.accepted ? '' : 'rejected'}`}
                  onClick={() => selectSegment(s)}
                >
                  <div className="segment-head">
                    <span className="time">
                      {formatTimecode(s.start)} - {formatTimecode(s.end)}
                    </span>
                    <span className="score">
                      {formatDuration(s.duration)}
                      {s.score != null ? ` · ${s.score.toFixed(2)}` : ''}
                    </span>
                  </div>
                  <div className="segment-fields">
                    <label>日/夜</label>
                    <select
                      value={s.dayNight}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        patchSegment(s.id, { dayNight: e.target.value as DayNight })
                      }
                    >
                      <option value="日">日</option>
                      <option value="夜">夜</option>
                      <option value="">(空)</option>
                    </select>
                    <label>造型</label>
                    <input
                      value={s.look}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => patchSegment(s.id, { look: e.target.value })}
                    />
                    <label>简述</label>
                    <input
                      value={s.summary}
                      placeholder="剧情一句话"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => patchSegment(s.id, { summary: e.target.value })}
                    />
                  </div>
                  <div className="filename-preview">{buildFilename({ ...s, episode })}</div>
                  <div className="segment-actions">
                    <button
                      className="btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleAccept(s.id)
                      }}
                    >
                      {s.accepted ? '排除' : '保留'}
                    </button>
                    <button
                      className="btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteSegment(s.id)
                      }}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>

      <footer className="bottom-export">
        <div className="hint-row">
          快捷键：空格播放 · J/L 变速 · ,/. 逐帧 · I/O 入出点 · E 建档 · A 分析 · Backspace 删除
        </div>
        <button
          className="btn btn-primary"
          disabled={!accepted.length || exporting}
          onClick={() => void exportAccepted()}
        >
          {exporting ? '导出中…' : `导出 ${accepted.length} 段 MP4`}
        </button>
      </footer>

      {enrollOpen && frameUrl ? (
        <div className="modal-backdrop" onClick={() => setEnrollOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(780px, 94vw)' }}>
            <h2>选择人脸建档</h2>
            <div style={{ position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden' }}>
              <img src={frameUrl} alt="frame" style={{ width: '100%', display: 'block' }} />
              {detectedFaces.map((f, idx) => {
                const [x, y, w, h] = f.box
                return (
                  <button
                    key={idx}
                    className="face-box"
                    style={{
                      left: `${(x / frameSize.w) * 100}%`,
                      top: `${(y / frameSize.h) * 100}%`,
                      width: `${(w / frameSize.w) * 100}%`,
                      height: `${(h / frameSize.h) * 100}%`,
                    }}
                    title={`置信度 ${f.score.toFixed(2)}`}
                    onClick={() => void enrollFace(f.box)}
                  />
                )
              })}
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setEnrollOpen(false)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                disabled={!detectedFaces.length}
                onClick={() => void enrollFace(detectedFaces[0]?.box)}
              >
                使用最大人脸
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
