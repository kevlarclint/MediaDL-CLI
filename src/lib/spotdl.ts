import {spawn} from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export type SpotifyTrack = {
  title: string
  artist: string
  album?: string
  duration?: number
  url: string
}

export type SpotifyProbeResult = {
  tracks: SpotifyTrack[]
  type: 'track' | 'playlist' | 'album' | 'artist'
  name?: string
  folderName?: string
}

// Force UTF-8 so Python doesn't crash on Unicode track names (Windows cp1252)
const PYTHON_ENV = {...process.env, PYTHONIOENCODING: 'utf-8'}

async function commandWorks(cmd: string, args: string[]): Promise<boolean> {
  return new Promise(resolve => {
    let child
    try {
      child = spawn(cmd, args, {stdio: 'ignore', timeout: 10_000})
    } catch {
      resolve(false)
      return
    }
    child.on('error', () => resolve(false))
    child.on('close', code => resolve(code === 0))
  })
}

export async function ensureSpotdl(onStatus: (message: string) => void, signal?: AbortSignal): Promise<string> {
  let spotdl: string | undefined

  if (await commandWorks('spotdl', ['--version'])) spotdl = 'spotdl'
  // Try python -m spotdl (common when installed via pip but not on PATH)
  else if (await commandWorks('python', ['-m', 'spotdl', '--version'])) spotdl = 'python -m spotdl'
  else {
    const local = path.join(os.homedir(), '.mediadl', 'bin', process.platform === 'win32' ? 'spotdl.exe' : 'spotdl')
    if (await commandWorks(local, ['--version'])) spotdl = local
  }

  if (!spotdl) {
    // Auto-install via pip
    onStatus('installing spotdl…')
    await installSpotdl(signal)

    // Re-check after install
    if (await commandWorks('spotdl', ['--version'])) spotdl = 'spotdl'
    else if (await commandWorks('python', ['-m', 'spotdl', '--version'])) spotdl = 'python -m spotdl'
    else {
      throw new Error(
        'spotdl installation failed. Try manually:\n' +
        '  pip install spotdl\n\n' +
        'Or visit: https://github.com/spotDL/spotify-downloader'
      )
    }
  }

  // Ensure Deno is available (required for some YouTube downloads)
  await ensureDeno(spotdl, onStatus, signal)

  return spotdl
}

async function ensureDeno(spotdl: string, onStatus: (message: string) => void, signal?: AbortSignal): Promise<void> {
  const {cmd, baseArgs} = parseSpotdlCmd(spotdl)
  // Check if deno is already available (spotdl stores it in ~/.spotdl/)
  const denoPath = path.join(os.homedir(), '.spotdl', process.platform === 'win32' ? 'deno.exe' : 'deno')
  if (await commandWorks(denoPath, ['--version'])) return
  if (await commandWorks('deno', ['--version'])) return

  // Auto-install Deno via spotdl
  onStatus('installing deno for youtube…')
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...baseArgs, '--download-deno'], {signal, env: PYTHON_ENV, stdio: 'ignore'})
    child.on('error', () => resolve()) // non-fatal
    child.on('close', () => resolve())
  })
}

async function installSpotdl(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pip', ['install', 'spotdl'], {signal, stdio: 'ignore'})
    child.on('error', reject)
    child.on('close', code => {
      if (signal?.aborted) reject(new Error('Installation cancelled.'))
      else if (code === 0) resolve()
      else reject(new Error(`pip install failed (exit code ${code}). Install manually: pip install spotdl`))
    })
  })
}

export async function probeSpotify(spotdl: string, url: string, signal?: AbortSignal): Promise<SpotifyProbeResult> {
  const tmpFile = path.join(os.tmpdir(), `mediadl-spotdl-${process.pid}-${Date.now()}.spotdl`)
  const {cmd, baseArgs} = parseSpotdlCmd(spotdl)

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(cmd, [...baseArgs, 'save', url, '--save-file', tmpFile, '--dont-filter-results'], {
        signal,
        env: PYTHON_ENV,
      })
      let stderr = ''
      child.stderr.on('data', chunk => (stderr += chunk))
      child.on('error', reject)
      child.on('close', code => {
        if (code === 0) resolve()
        else reject(new Error(cleanSpotdlError(stderr) || `spotdl exited with code ${code}`))
      })
    })

    const raw = await fs.readFile(tmpFile, 'utf8')
    const data = JSON.parse(raw) as Array<{
      name: string
      artists: string[]
      album_name?: string
      duration?: number
      url?: string
      song_id?: string
      list_name?: string
    }>

    const tracks: SpotifyTrack[] = data.map(item => ({
      title: item.name,
      artist: item.artists.join(', '),
      album: item.album_name,
      duration: item.duration,
      url: item.url ?? `https://open.spotify.com/track/${item.song_id}`,
    }))

    const type = detectSpotifyLinkType(url)
    const name = type === 'track' ? tracks[0]?.title : undefined
    // Use list_name (playlist name from Spotify) for playlists, album_name for albums
    // Check all tracks for list_name since first track might not have it
    const listName = data.find(item => item.list_name)?.list_name
    const folderName = type === 'track' ? undefined : sanitizeFolderName(
      listName ?? tracks[0]?.album ?? (type === 'album' ? 'Spotify Album' : 'Spotify Playlist')
    )

    return {tracks, type, name, folderName}
  } finally {
    await fs.rm(tmpFile, {force: true}).catch(() => {})
  }
}

function detectSpotifyLinkType(url: string): SpotifyProbeResult['type'] {
  if (url.includes('/track/')) return 'track'
  if (url.includes('/playlist/')) return 'playlist'
  if (url.includes('/album/')) return 'album'
  if (url.includes('/artist/')) return 'artist'
  return 'track'
}

function sanitizeFolderName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '')  // strip invalid filesystem chars
    .replace(/\s+/g, ' ')          // collapse whitespace
    .trim()
    .slice(0, 60)
}

function parseSpotdlCmd(spotdl: string): {cmd: string; baseArgs: string[]} {
  if (spotdl === 'python -m spotdl') return {cmd: 'python', baseArgs: ['-m', 'spotdl']}
  return {cmd: spotdl, baseArgs: []}
}

export type SpotifyDownloadProgress = {
  downloaded: number
  total: number
  currentTrack?: string
  failed: number
}

export type SpotifyDownloadHandlers = {
  onProgress: (progress: SpotifyDownloadProgress) => void
  onTrackDone: (title: string) => void
  onError: (message: string) => void
}

export async function downloadSpotify(
  opts: {
    spotdl: string
    url: string
    outDir: string
    totalTracks: number
    folderName?: string
  },
  handlers: SpotifyDownloadHandlers,
  signal?: AbortSignal,
): Promise<string[]> {
  // For playlists/albums, create a subfolder
  const downloadDir = opts.folderName
    ? path.join(opts.outDir, opts.folderName)
    : opts.outDir
  const outputTemplate = path.join(downloadDir, '{artist} - {title}.{output-ext}')
  const {cmd, baseArgs} = parseSpotdlCmd(opts.spotdl)

  return new Promise((resolve, reject) => {
    const child = spawn(
      cmd,
      [...baseArgs, 'download', opts.url, '--output', outputTemplate, '--overwrite', 'force'],
      {signal, env: PYTHON_ENV},
    )

    let stderr = ''
    let downloaded = 0
    let failed = 0
    const files: string[] = []
    let buffer = ''

    // Rich uses \r for in-place progress updates — split on both \r and \n
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''

      for (const rawLine of lines) {
        // Strip ANSI escape codes (Rich colors, progress bars)
        const line = rawLine.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim()
        if (!line) continue

        const downloadedMatch = /^Downloaded\s+"(.+)"[:]?$/.exec(line)
        if (downloadedMatch) {
          downloaded++
          const title = downloadedMatch[1] ?? ''
          handlers.onTrackDone(title)
          handlers.onProgress({downloaded, total: opts.totalTracks, failed})
          continue
        }

        const skippedMatch = /^Skipped\s+"(.+)"[:]?$/.exec(line)
        if (skippedMatch) {
          downloaded++
          handlers.onProgress({downloaded, total: opts.totalTracks, failed})
          continue
        }

        const errorMatch = /^Error\s+"(.+)"[:]?$/.exec(line)
        if (errorMatch) {
          failed++
          handlers.onError(errorMatch[1] ?? 'Unknown error')
          handlers.onProgress({downloaded, total: opts.totalTracks, failed})
          continue
        }

        if (line.includes('Processing') || line.includes('Searching')) {
          handlers.onProgress({downloaded, total: opts.totalTracks, currentTrack: line, failed})
        }
      }
    })

    child.stderr.on('data', chunk => (stderr += chunk))

    child.on('error', reject)

    child.on('close', code => {
      if (signal?.aborted) {
        reject(new Error('Download cancelled.'))
        return
      }

      if (code === 0) {
        resolve(files.length > 0 ? files : [downloadDir])
      } else {
        reject(new Error(cleanSpotdlError(stderr) || `spotdl exited with code ${code}.`))
      }
    })
  })
}

function cleanSpotdlError(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('WARNING'))
  const last = lines.at(-1)
  return last ? last.slice(0, 200) : ''
}
