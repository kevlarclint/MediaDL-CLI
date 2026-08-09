import React, {useCallback, useEffect, useRef, useState} from 'react'
import os from 'node:os'
import path from 'node:path'
import {Box, Text, useApp, useInput, useStdout} from 'ink'
import SelectInput, {type IndicatorProps, type ItemProps} from 'ink-select-input'
import Spinner from 'ink-spinner'
import {FramedInput} from './components/framed-input.js'
import {FullScreen} from './components/fullscreen.js'
import {Logo} from './components/logo.js'
import {Panel} from './components/panel.js'
import {ProgressBar} from './components/progress-bar.js'
import {Shortcuts} from './components/shortcuts.js'
import {TextInput} from './components/text-input.js'
import {clickTargetAt, findFrameRow, frameRowSpan, type ClickTarget} from './lib/click-map.js'
import {formatBytes, formatDuration, formatEta, formatSpeed, shortenPath, truncate, wrapText} from './lib/format.js'
import {addToHistory, loadHistory} from './lib/history.js'
import {detectPlatform, isProbablyUrl, isSpotifyUrl, type Platform} from './lib/platforms.js'
import {
  ensureSpotdl,
  probeSpotify,
  downloadSpotify,
  type SpotifyTrack,
  type SpotifyProbeResult,
  type SpotifyDownloadProgress,
} from './lib/spotdl.js'
import {useMouseClick} from './lib/use-mouse-click.js'
import {nextThemeMode, ThemeProvider, type ThemeMode, useTheme} from './theme.js'
import {
  buildChoices,
  download,
  ensureYtDlp,
  findFfmpeg,
  probe,
  type DownloadChoice,
  type DownloadProgress,
  type VideoInfo,
} from './lib/ytdlp.js'

const OUT_DIR = path.join(os.homedir(), 'Downloads')
const DOWNLOAD_BUTTON = 'download'
const DONE_LABEL = '↵ download another'
const TAGLINE = 'download media. simple, fast, local.'

const choiceLabel = (choice: DownloadChoice) => `${choice.kind === 'audio' ? '♪ ' : '▶ '}${choice.label}`

function ChoiceIndicator({isSelected}: IndicatorProps) {
  const theme = useTheme()
  return (
    <Box marginRight={1}>
      <Text color={theme.primary}>{isSelected ? '❯' : ' '}</Text>
    </Box>
  )
}

function ChoiceItem({isSelected, label}: ItemProps) {
  const theme = useTheme()
  return (
    <Text color={theme.primary} bold={isSelected}>
      {label}
    </Text>
  )
}

// explicit blank lines — empty <Box height={1}/> spacers can collapse, and
// ink boxes default to flexShrink=1, so spacers are the first thing yoga
// crushes when content overflows the terminal
const Gap = ({lines = 1}: {lines?: number}) => (
  <Box flexDirection="column" flexShrink={0}>
    {Array.from({length: lines}, (_, i) => (
      <Text key={i}> </Text>
    ))}
  </Box>
)

// fixed-width slots — the centered line must not change width as values tick,
// otherwise the whole layout shifts on every progress update
function partLabel(progress: DownloadProgress): string {
  // explains the bar resetting between files (video, then audio)
  return progress.totalParts > 1 ? `part ${progress.part + 1}/${progress.totalParts}  ` : ''
}

function downloadMeta(progress: DownloadProgress): string {
  const speed = progress.speed ? formatSpeed(progress.speed) : ''
  const eta = progress.eta ? `${formatEta(progress.eta)} left` : ''
  return `${partLabel(progress)}${speed.padStart(10)}  ${eta.padEnd(12)}`
}

function indeterminateMeta(progress: DownloadProgress): string {
  const bytes = formatBytes(progress.downloadedBytes)
  const speed = progress.speed ? formatSpeed(progress.speed) : ''
  return `${partLabel(progress)}${bytes.padStart(8)}  ${speed.padEnd(10)}`
}

export type Outcome = {filepath?: string; trackCount?: number; folderPath?: string}

type Phase =
  | {name: 'input'; warning?: string}
  | {name: 'probing'; status: string}
  | {name: 'picking'}
  | {name: 'spotify-confirm'}
  | {
      name: 'downloading'
      choice?: DownloadChoice
      progress?: DownloadProgress
      processing: boolean
      refreshing?: boolean
    }
  | {name: 'spotify-downloading'; progress: SpotifyDownloadProgress}
  | {name: 'done'; filepath?: string; trackCount?: number; folderPath?: string}
  | {name: 'error'; message: string}

const HINTS: Record<Phase['name'], Array<[string, string]>> = {
  input: [
    ['↵', 'download'],
    ['^c', 'quit'],
  ],
  probing: [
    ['esc', 'cancel'],
    ['^c', 'quit'],
  ],
  picking: [
    ['↑↓', 'choose'],
    ['↵', 'download'],
    ['esc', 'back'],
    ['^c', 'quit'],
  ],
  'spotify-confirm': [
    ['↵', 'download all'],
    ['esc', 'back'],
    ['^c', 'quit'],
  ],
  downloading: [
    ['esc', 'cancel'],
    ['^c', 'quit'],
  ],
  'spotify-downloading': [
    ['esc', 'cancel'],
    ['^c', 'quit'],
  ],
  done: [['^c', 'quit']],
  error: [
    ['↵', 'try again'],
    ['^c', 'quit'],
  ],
}

type AppProps = {
  initialUrl?: string
  clipboardUrl?: string
  initialThemeMode?: ThemeMode
  onOutcome: (outcome: Outcome) => void
}

export function App({initialThemeMode = 'auto', ...props}: AppProps) {
  const [themeMode, setThemeMode] = useState(initialThemeMode)
  const cycleTheme = useCallback(() => {
    setThemeMode(nextThemeMode)
  }, [])

  return (
    <ThemeProvider mode={themeMode}>
      <AppContent {...props} cycleTheme={cycleTheme} />
    </ThemeProvider>
  )
}

function AppContent({
  initialUrl,
  clipboardUrl,
  onOutcome,
  cycleTheme,
}: {
  initialUrl?: string
  clipboardUrl?: string
  onOutcome: (outcome: Outcome) => void
  cycleTheme: () => void
}) {
  const theme = useTheme()
  const {exit} = useApp()
  const {stdout} = useStdout()
  const [url, setUrl] = useState(initialUrl ?? '')
  const [urlInput, setUrlInput] = useState('')
  const [history, setHistory] = useState(loadHistory)
  const [platform, setPlatform] = useState<Platform>()
  const [info, setInfo] = useState<VideoInfo>()
  const [choices, setChoices] = useState<DownloadChoice[]>([])
  const ytdlpRef = useRef('')
  const spotdlRef = useRef('')
  const highlightRef = useRef(0) // choice under the cursor, for the ↵ hint click
  const infoJsonRef = useRef<string | undefined>(undefined)
  const abortRef = useRef<AbortController | undefined>(undefined)
  const [spotifyProbe, setSpotifyProbe] = useState<SpotifyProbeResult | undefined>()
  const [phase, setPhase] = useState<Phase>(initialUrl ? {name: 'probing', status: 'warming up…'} : {name: 'input'})

  const columns = stdout?.columns && stdout.columns > 0 ? stdout.columns : 80
  const boxWidth = Math.max(14, Math.min(64, columns - 6))
  const contentWidth = Math.max(10, Math.min(columns - 4, 78))

  const startProbe = useCallback(async (targetUrl: string) => {
    const controller = new AbortController()
    abortRef.current = controller
    setPlatform(detectPlatform(targetUrl))
    setPhase({name: 'probing', status: 'warming up…'})

    try {
      if (isSpotifyUrl(targetUrl)) {
        // Spotify path
        const spotdl =
          spotdlRef.current ||
          (await ensureSpotdl(status => setPhase({name: 'probing', status}), controller.signal))
        spotdlRef.current = spotdl
        if (controller.signal.aborted) return
        setPhase({name: 'probing', status: 'fetching spotify tracks…'})
        const result = await probeSpotify(spotdl, targetUrl, controller.signal)
        if (controller.signal.aborted) return
        setSpotifyProbe(result)

        if (result.tracks.length === 1) {
          // Single track — skip confirmation, start download
          handleSpotifyDownload(targetUrl, result)
        } else {
          // Playlist/album — show confirmation
          setPhase({name: 'spotify-confirm'})
        }
      } else {
        // yt-dlp path (unchanged)
        const ytdlp =
          ytdlpRef.current ||
          (await ensureYtDlp(status => setPhase({name: 'probing', status}), controller.signal))
        ytdlpRef.current = ytdlp
        if (controller.signal.aborted) return
        setPhase({name: 'probing', status: 'fetching video info…'})
        const {info: videoInfo, infoJsonPath} = await probe(ytdlp, targetUrl, controller.signal)
        if (controller.signal.aborted) return
        infoJsonRef.current = infoJsonPath
        setInfo(videoInfo)
        setChoices(buildChoices(videoInfo))
        highlightRef.current = 0
        setPhase({name: 'picking'})
      }
    } catch (error) {
      if (controller.signal.aborted) return
      setPhase({name: 'error', message: error instanceof Error ? error.message : String(error)})
    }
  }, [])

  useEffect(() => {
    if (initialUrl) void startProbe(initialUrl)
  }, [initialUrl, startProbe])

  const resetToInput = useCallback(() => {
    setUrl('')
    setUrlInput('')
    setPlatform(undefined)
    setInfo(undefined)
    setChoices([])
    setSpotifyProbe(undefined)
    setPhase({name: 'input'})
  }, [])

  const cancelRun = useCallback(() => {
    abortRef.current?.abort()
    resetToInput()
    setUrlInput(url) // keep the link around so a cancel isn't destructive
  }, [resetToInput, url])

  useInput(
    (input, key) => {
      if (key.ctrl && input === 't') {
        cycleTheme()
        return
      }
      if (key.escape && (phase.name === 'picking' || phase.name === 'spotify-confirm' || phase.name === 'error' || phase.name === 'done')) resetToInput()
      if (key.escape && (phase.name === 'probing' || phase.name === 'downloading' || phase.name === 'spotify-downloading')) cancelRun()
      if (key.return && (phase.name === 'error' || phase.name === 'done')) resetToInput()
      if (key.return && phase.name === 'spotify-confirm') handleSpotifyDownload(url, spotifyProbe!)
    },
    {isActive: Boolean(process.stdin.isTTY)},
  )

  const handleUrlSubmit = (value: string) => {
    const trimmed = value.trim()
    if (!isProbablyUrl(trimmed)) {
      setPhase({name: 'input', warning: 'that doesn\'t look like a link — paste a full url'})
      return
    }
    setUrl(trimmed)
    void startProbe(trimmed)
  }

  const clipboardOffered = Boolean(clipboardUrl) && urlInput === ''
  const clipboardAccepted = Boolean(clipboardUrl) && urlInput === clipboardUrl

  const handlePick = (item: {value: number}) => {
    const choice = choices[item.value]
    const controller = new AbortController()
    abortRef.current = controller
    setPhase({name: 'downloading', choice, processing: false})
    void (async () => {
      const handlers = {
        onProgress: (progress: DownloadProgress) =>
          setPhase(prev => (prev.name === 'downloading' ? {...prev, progress, processing: false} : prev)),
        onProcessing: () =>
          setPhase(prev => (prev.name === 'downloading' ? {...prev, processing: true} : prev)),
      }
      try {
        const ffmpegLocation = await findFfmpeg()
        const base = {ytdlp: ytdlpRef.current, ffmpegLocation, url, choice, outDir: OUT_DIR}
        let filepath: string
        try {
          // reuse the probe's metadata — starts immediately instead of re-extracting
          filepath = await download({...base, infoJsonPath: infoJsonRef.current}, handlers, controller.signal)
        } catch (error) {
          if (controller.signal.aborted) throw error
          // media urls in the cached info can expire — retry with a fresh extraction
          setPhase(prev =>
            prev.name === 'downloading' ? {...prev, progress: undefined, refreshing: true} : prev,
          )
          filepath = await download(base, handlers, controller.signal)
        }
        onOutcome({filepath})
        setHistory(addToHistory(url))
        setPhase({name: 'done', filepath})
      } catch (error) {
        if (controller.signal.aborted) return
        setPhase({name: 'error', message: error instanceof Error ? error.message : String(error)})
      }
    })()
  }

  const handleSpotifyDownload = useCallback((targetUrl: string, probeResult: SpotifyProbeResult) => {
    const controller = new AbortController()
    abortRef.current = controller
    const totalTracks = probeResult.tracks.length
    const folderName = probeResult.folderName
    setPhase({
      name: 'spotify-downloading',
      progress: {downloaded: 0, total: totalTracks, failed: 0},
    })

    void (async () => {
      try {
        const spotdl = spotdlRef.current
        if (!spotdl) throw new Error('spotdl not available')

        await downloadSpotify(
          {spotdl, url: targetUrl, outDir: OUT_DIR, totalTracks, folderName},
          {
            onProgress: progress =>
              setPhase(prev => (prev.name === 'spotify-downloading' ? {...prev, progress} : prev)),
            onTrackDone: () => {},
            onError: () => {},
          },
          controller.signal,
        )

        const folderPath = folderName ? path.join(OUT_DIR, folderName) : undefined
        onOutcome({trackCount: totalTracks, folderPath})
        setHistory(addToHistory(targetUrl))
        setPhase({name: 'done', trackCount: totalTracks, folderPath})
      } catch (error) {
        if (controller.signal.aborted) return
        setPhase({name: 'error', message: error instanceof Error ? error.message : String(error)})
      }
    })()
  }, [onOutcome])

  let hints: Array<[string, string]> = [...HINTS[phase.name], ['^t', `theme:${theme.mode}`]]
  if (phase.name === 'input' && history.length > 0) {
    hints = [hints[0]!, ['↑', 'history'], ...hints.slice(1)]
  }

  // Anything a mouse user would expect to press is clickable. Targets are
  // found by their text in the rendered frame (see lib/click-map.ts), so
  // there is no layout math to keep in sync.
  const hintAction = (key: string): (() => void) | undefined => {
    if (key === '^c') return () => exit()
    if (key === '^t') return cycleTheme
    if (key === 'esc') return phase.name === 'probing' || phase.name === 'downloading' || phase.name === 'spotify-downloading' ? cancelRun : resetToInput
    if (key === '↵') {
      if (phase.name === 'input') return () => handleUrlSubmit(urlInput)
      if (phase.name === 'picking') return () => handlePick({value: highlightRef.current})
      if (phase.name === 'spotify-confirm') return () => handleSpotifyDownload(url, spotifyProbe!)
      if (phase.name === 'error' || phase.name === 'done') return resetToInput
    }
    return undefined // ↑↓ / ↑ stay keyboard-only
  }
  const clickTargets: ClickTarget[] = []
  if (phase.name === 'input') {
    // the frame button rows above/below the label are part of the button
    clickTargets.push({match: `  ${DOWNLOAD_BUTTON}  `, padY: 1, action: () => handleUrlSubmit(urlInput)})
  }
  if (phase.name === 'picking') {
    for (const [index, choice] of choices.entries()) {
      clickTargets.push({match: choiceLabel(choice), action: () => handlePick({value: index})})
    }
  }
  if (phase.name === 'spotify-confirm') {
    clickTargets.push({match: `  ${DOWNLOAD_BUTTON} all  `, padY: 1, action: () => handleSpotifyDownload(url, spotifyProbe!)})
  }
  if (phase.name === 'done') {
    clickTargets.push({match: DONE_LABEL, padX: 4, padY: 1, action: resetToInput})
  }
  for (const [key, label] of hints) {
    const action = hintAction(key)
    if (action) clickTargets.push({match: `${key} ${label}`, action})
  }

  useMouseClick(
    (x, y) => {
      // the logo takes you home — it's the 3 rows one gap above the tagline
      const taglineRow = findFrameRow(TAGLINE)
      if (taglineRow > 3 && y - 1 >= taglineRow - 4 && y - 1 <= taglineRow - 2) {
        const span = frameRowSpan(y - 1)
        if (span && x >= span[0] - 1 && x <= span[1] + 1) {
          if (phase.name === 'probing' || phase.name === 'downloading' || phase.name === 'spotify-downloading') cancelRun()
          else if (phase.name !== 'input') resetToInput()
          return
        }
      }
      clickTargetAt(x, y, clickTargets)?.action()
    },
    Boolean(process.stdin.isTTY),
  )

  const spotifyTotalDuration = spotifyProbe?.tracks.reduce((sum, t) => sum + (t.duration ?? 0), 0) ?? 0

  return (
    <FullScreen>
      <Logo />
      <Gap />
      <Text color={theme.primary}>{TAGLINE}</Text>
      <Text color={theme.gray} dimColor={theme.dimSecondary}>youtube · spotify · tiktok · and many more</Text>
      <Gap />

      {phase.name === 'input' && (
        <Box flexDirection="column" alignItems="center">
          <FramedInput title="Paste a link/playlist" width={boxWidth} button={DOWNLOAD_BUTTON}>
            <TextInput
              value={urlInput}
              onChange={setUrlInput}
              onSubmit={handleUrlSubmit}
              placeholder="youtube.com/watch?v=…"
              width={boxWidth - 6}
              history={history}
              submitOnPaste={isProbablyUrl}
              onTab={() => {
                if (clipboardOffered) setUrlInput(clipboardUrl!)
              }}
            />
          </FramedInput>
          {phase.warning ? (
            <Text color={theme.gray} dimColor={theme.dimSecondary}>✗ {phase.warning}</Text>
          ) : clipboardOffered ? (
            <Text color={theme.gray} dimColor={theme.dimSecondary}>link in your clipboard — ⇥ to paste it</Text>
          ) : clipboardAccepted ? (
            <Text color={theme.gray} dimColor={theme.dimSecondary}>from your clipboard — ↵ to download it</Text>
          ) : null}
        </Box>
      )}

      {phase.name === 'probing' && (
        <Box flexDirection="column" alignItems="center">
          <FramedInput title={platform ? platform.label : 'Paste a link/playlist'} width={boxWidth} button={DOWNLOAD_BUTTON} buttonDim>
            <Text color={theme.gray} dimColor={theme.dimSecondary}>{url.length > boxWidth - 8 ? `${url.slice(0, boxWidth - 9)}…` : url}</Text>
          </FramedInput>
        </Box>
      )}

      {phase.name === 'picking' && platform && (
        <Box width={contentWidth}>
          <Box flexDirection="column" flexGrow={1} flexBasis={0} paddingTop={1} paddingRight={3}>
            {/* wrapped by hand so continuation lines stay flush left —
                ink's wrapping keeps the break's space as a 1-cell indent */}
            {wrapText(info?.title ?? '', Math.max(10, contentWidth - 41)).map((line, index) => (
              <Text key={index} bold color={theme.primary}>
                {line}
              </Text>
            ))}
            <Gap />
            <Text color={theme.gray} dimColor={theme.dimSecondary}>
              ▸ {platform.label}
              {info?.duration ? ` · ${formatDuration(info.duration)}` : ''}
              {info?.uploader ? ` · ${info.uploader}` : ''}
            </Text>
          </Box>
          <Panel title="Download" width={38}>
            <SelectInput
              indicatorComponent={ChoiceIndicator}
              itemComponent={ChoiceItem}
              items={choices.map((choice, index) => ({
                key: String(index),
                label: choiceLabel(choice),
                value: index,
              }))}
              onSelect={handlePick}
              onHighlight={item => (highlightRef.current = item.value)}
            />
          </Panel>
        </Box>
      )}

      {phase.name === 'spotify-confirm' && spotifyProbe && (
        <Box flexDirection="column" alignItems="center" width={contentWidth}>
          <Panel title="Spotify" width={Math.min(56, contentWidth)}>
            <Box flexDirection="column">
              {spotifyProbe.name && (
                <Text bold color={theme.primary}>{spotifyProbe.name}</Text>
              )}
              <Text color={theme.gray} dimColor={theme.dimSecondary}>
                {spotifyProbe.tracks.length} track{spotifyProbe.tracks.length !== 1 ? 's' : ''}
                {spotifyTotalDuration > 0 ? ` · ${formatDuration(spotifyTotalDuration)}` : ''}
              </Text>
              <Gap />
              <Box flexDirection="column" maxHeight={Math.min(spotifyProbe.tracks.length, 10)}>
                {spotifyProbe.tracks.slice(0, 10).map((track, i) => (
                  <Text key={i} color={theme.gray} dimColor={theme.dimSecondary}>
                    {`  ${i + 1}. ${truncate(track.artist, 20)} — ${truncate(track.title, 28)}`}
                  </Text>
                ))}
                {spotifyProbe.tracks.length > 10 && (
                  <Text color={theme.gray} dimColor={theme.dimSecondary}>
                    {`  … and ${spotifyProbe.tracks.length - 10} more`}
                  </Text>
                )}
              </Box>
            </Box>
          </Panel>
          <Gap />
          <Box
            borderStyle="round"
            borderColor={theme.gray}
            borderDimColor={theme.dimSecondary}
            borderBackgroundColor={theme.background}
            paddingX={3}
          >
            <Text bold color={theme.primary}>{DOWNLOAD_BUTTON} all</Text>
          </Box>
        </Box>
      )}

      {phase.name === 'downloading' && (
        <Box flexDirection="column" alignItems="center">
          <Text color={theme.gray} dimColor={theme.dimSecondary}>
            {info?.title ? `${truncate(info.title, 42)} · ` : ''}
            {phase.choice?.label ?? ''}
          </Text>
          <Gap />
          {/* every branch is exactly three rows — bar, gap, meta — so the layout never jumps */}
          {phase.processing ? (
            <>
              <ProgressBar percent={1} />
              <Gap />
              <Text>
                <Text color={theme.primary}>
                  <Spinner type="dots" />
                </Text>
                <Text color={theme.gray} dimColor={theme.dimSecondary}> processing…</Text>
              </Text>
            </>
          ) : phase.progress?.totalBytes ? (
            <>
              <ProgressBar percent={phase.progress.downloadedBytes / phase.progress.totalBytes} />
              <Gap />
              <Text color={theme.gray} dimColor={theme.dimSecondary}>{downloadMeta(phase.progress)}</Text>
            </>
          ) : phase.progress ? (
            <>
              <Text>
                <Text color={theme.primary}>
                  <Spinner type="dots" />
                </Text>
                <Text color={theme.gray} dimColor={theme.dimSecondary}> downloading…</Text>
              </Text>
              <Gap />
              <Text color={theme.gray} dimColor={theme.dimSecondary}>{indeterminateMeta(phase.progress)}</Text>
            </>
          ) : (
            <>
              <ProgressBar percent={0} />
              <Gap />
              <Text>
                <Text color={theme.primary}>
                  <Spinner type="dots" />
                </Text>
                <Text color={theme.gray} dimColor={theme.dimSecondary}>
                  {phase.refreshing ? ' link expired — grabbing a fresh one…' : ' starting download…'}
                </Text>
              </Text>
            </>
          )}
        </Box>
      )}

      {phase.name === 'spotify-downloading' && (
        <Box flexDirection="column" alignItems="center">
          <Text color={theme.gray} dimColor={theme.dimSecondary}>
            {spotifyProbe?.name ?? 'Spotify'} · {phase.progress.total} track{phase.progress.total !== 1 ? 's' : ''}
          </Text>
          <Gap />
          <ProgressBar percent={phase.progress.total > 0 ? phase.progress.downloaded / phase.progress.total : 0} />
          <Gap />
          <Text>
            <Text color={theme.primary}>
              <Spinner type="dots" />
            </Text>
            <Text color={theme.gray} dimColor={theme.dimSecondary}>
              {' '}
              {phase.progress.currentTrack
                ? truncate(phase.progress.currentTrack, 40)
                : `downloading ${phase.progress.downloaded}/${phase.progress.total}`}
              {phase.progress.failed > 0 ? ` (${phase.progress.failed} failed)` : ''}
            </Text>
          </Text>
        </Box>
      )}

      {phase.name === 'done' && (
        <Box flexDirection="column" alignItems="center">
          {phase.trackCount ? (
            <>
              <Text>
                <Text bold color={theme.primary}>✓ downloaded! </Text>
                <Text color={theme.primary}>{phase.trackCount} track{phase.trackCount !== 1 ? 's' : ''} saved to:</Text>
              </Text>
              <Text color={theme.gray} dimColor={theme.dimSecondary}>
                {shortenPath(phase.folderPath ?? OUT_DIR, os.homedir(), 60)}
              </Text>
            </>
          ) : (
            <>
              <Text>
                <Text bold color={theme.primary}>✓ downloaded! </Text>
                <Text color={theme.primary}>find your file in:</Text>
              </Text>
              <Text color={theme.gray} dimColor={theme.dimSecondary}>{shortenPath(phase.filepath ?? '', os.homedir(), 60)}</Text>
            </>
          )}
          <Gap />
          <Box
            borderStyle="round"
            borderColor={theme.gray}
            borderDimColor={theme.dimSecondary}
            borderBackgroundColor={theme.background}
            paddingX={3}
          >
            <Text bold color={theme.primary}>{DONE_LABEL}</Text>
          </Box>
        </Box>
      )}

      {phase.name === 'error' && (
        <Box flexDirection="column" alignItems="center" width={Math.max(10, Math.min(columns - 6, 72))}>
          <Text bold color={theme.primary}>✗ {phase.message}</Text>
        </Box>
      )}

      {hints.length > 0 ? (
        <>
          <Gap lines={2} />
          <Shortcuts
            items={hints}
            leading={
              phase.name === 'probing' ? (
                <Text>
                  <Text color={theme.primary}>
                    <Spinner type="dots" />
                  </Text>
                  <Text color={theme.gray} dimColor={theme.dimSecondary}> {phase.status}</Text>
                </Text>
              ) : undefined
            }
          />
        </>
      ) : null}

      <Box flexGrow={1} />

      <Box flexDirection="column" alignItems="center">
  <Gap lines={0.5} />
  <Text color="#71717a" dimColor={theme.dimSecondary}>
    ────────────────────────────────────────
  </Text>
  <Gap lines={0.5} />

  <Text color="#71717a" dimColor={theme.dimSecondary}>
    Built by Clint Lorenzo · Based on Yoink (MIT)
  </Text>
  <Text color="#71717a" dimColor={theme.dimSecondary}>
    Powered by yt-dlp, spotDL, FFmpeg
  </Text>
  <Gap lines={0.5} />

  <Text color="#71717a" dimColor={theme.dimSecondary}>
    https://mediadl.cli.kevlarclint.indevs.in
  </Text>
  <Gap lines={0.5} />
</Box>
    </FullScreen>
  )
}
