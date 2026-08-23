const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')
const { pathToFileURL } = require('url')

const ANALYZER_PORT = 8765
const isDev = !app.isPackaged

let mainWindow = null
let analyzerProc = null

function analyzerDir() {
  if (isDev) return path.join(__dirname, '..', 'analyzer')
  return path.join(process.resourcesPath, 'analyzer')
}

function startAnalyzer() {
  const cwd = analyzerDir()
  const script = path.join(cwd, 'server.py')
  const pythonCandidates = process.platform === 'win32'
    ? ['python', 'python3']
    : ['python3', 'python']

  let started = false
  for (const bin of pythonCandidates) {
    try {
      analyzerProc = spawn(bin, [script], {
        cwd,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      started = true
      break
    } catch {
      // try next
    }
  }
  if (!started || !analyzerProc) {
    console.error('Failed to start Python analyzer')
    return
  }
  analyzerProc.stdout.on('data', (d) => console.log(`[analyzer] ${d}`))
  analyzerProc.stderr.on('data', (d) => console.error(`[analyzer] ${d}`))
  analyzerProc.on('exit', (code) => console.log(`analyzer exited: ${code}`))
}

async function waitForAnalyzer(timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${ANALYZER_PORT}/health`)
      if (res.ok) return true
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#1a1b1e',
    title: 'AI砍柴',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(async () => {
  protocol.handle('local-media', (request) => {
    const url = request.url.replace('local-media://', '')
    const decoded = decodeURIComponent(url)
    return net.fetch(pathToFileURL(decoded).toString())
  })

  startAnalyzer()
  await waitForAnalyzer()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (analyzerProc) {
    analyzerProc.kill()
    analyzerProc = null
  }
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('dialog:openVideo', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择视频',
    properties: ['openFile'],
    filters: [
      { name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'avi', 'm4v', 'ts', 'flv', 'webm'] },
      { name: 'All', extensions: ['*'] },
    ],
  })
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})

ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择导出目录',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})

ipcMain.handle('dialog:saveFrame', async (_e, payload) => {
  const { dataUrl, suggestedName } = payload
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
  const tmp = path.join(app.getPath('temp'), suggestedName || `frame-${Date.now()}.jpg`)
  fs.writeFileSync(tmp, Buffer.from(base64, 'base64'))
  return tmp
})

ipcMain.handle('path:toMediaUrl', (_e, filePath) => {
  return `local-media://${encodeURIComponent(filePath)}`
})

ipcMain.handle('analyzer:fetch', async (_e, { method, path: apiPath, body }) => {
  const res = await fetch(`http://127.0.0.1:${ANALYZER_PORT}${apiPath}`, {
    method: method || 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = { raw: text }
  }
  if (!res.ok) {
    const msg = data?.detail || data?.error || text || res.statusText
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return data
})
