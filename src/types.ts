export type DayNight = '日' | '夜' | ''

export interface VideoInfo {
  path: string
  mediaUrl: string
  name: string
  duration: number
  fps: number
  width: number
  height: number
}

export interface CharacterProfile {
  id: string
  name: string
  lookLabel: string
  embedding: number[]
  previewDataUrl?: string
}

export interface Segment {
  id: string
  start: number
  end: number
  duration: number
  score?: number
  source?: string
  accepted: boolean
  episode: string
  clipNo: number
  dayNight: DayNight
  look: string
  summary: string
}

export interface AnalyzeProgress {
  status: 'idle' | 'running' | 'done' | 'error'
  percent: number
  stage?: string
  error?: string
}

declare global {
  interface Window {
    kanchai: {
      openVideo: () => Promise<string | null>
      openDirectory: () => Promise<string | null>
      saveFrame: (dataUrl: string, suggestedName?: string) => Promise<string>
      toMediaUrl: (filePath: string) => Promise<string>
      getPathForFile: (file: File) => string
      analyzer: (method: string, path: string, body?: unknown) => Promise<any>
    }
  }
}
