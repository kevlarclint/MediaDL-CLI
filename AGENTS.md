# AGENTS.md

## Commands

```sh
npm run build        # bundle src/cli.tsx → dist/cli.js (tsup, ESM, shebang)
npm run dev          # rebuild on change
npm run test         # node --test via tsx (pattern: src/**/*.test.ts)
npm run typecheck    # tsc --noEmit
node dist/cli.js     # run the built CLI
npm link             # register "mediadl" as a global command for local testing
```

No lint or format scripts are defined. `prepublishOnly` runs test → typecheck → build.

## Architecture

**mediadl** is a terminal media downloader TUI, forked from [yoinks](https://github.com/pablostanley/yoinks). Built with [Ink](https://github.com/vadimdemedes/ink) (React for the terminal). Run the TUI with `mediadl` after `npm link`.

- `src/cli.tsx` — entrypoint. Parses args, manages alt screen, renders `<App>`, prints final filepath.
- `src/app.tsx` — main component. Phase state machine with two backends:
  - **yt-dlp path**: `input → probing → picking → downloading → done/error`
  - **Spotify path**: `input → probing → spotify-confirm → spotify-downloading → done/error` (single tracks skip confirmation)
- `src/theme.ts` — three modes (`auto`/`light`/`dark`). `auto` leaves colors unset so the terminal's own palette shows through.
- `src/components/` — Ink UI components (`FramedInput`, `Panel`, `ProgressBar`, `Logo`, `Shortcuts`, `TextInput`, `FullScreen`).
- `src/lib/ytdlp.ts` — yt-dlp lifecycle: download binary on first run to `~/.mediadl/bin`, probe video info (`-J`), build format choices, stream download with progress parsing.
- `src/lib/spotdl.ts` — spotdl lifecycle: check PATH for `spotdl`, probe Spotify metadata, download tracks. Requires `pip install spotdl`.
- `src/lib/platforms.ts` — URL pattern matching for platform detection. Includes `isSpotifyUrl()` and `parseSpotifyUrl()`.
- `src/lib/click-map.ts` — mouse click hit-testing by matching rendered text in the frame buffer (no layout math).
- `src/lib/format.ts` — byte/duration/speed formatting and text wrapping helpers.
- `src/lib/history.ts` — URL history persisted to disk.
- `src/lib/args.ts` — CLI argument parser (manual, no dependency).

## Key conventions

- **ESM-only** (`"type": "module"`). All local imports use `.js` extensions (e.g. `./lib/args.js`).
- **JSX**: `react-jsx` transform — no `React` import needed in new files (though existing files import it explicitly).
- **Tests**: Node's built-in `node:test` runner with `node:assert/strict`. Test files are co-located as `*.test.ts`. Only two test files exist: `src/lib/args.test.ts`, `src/components/panel.test.ts`.
- **VERSION** is read at runtime from `package.json` via `createRequire`, not hardcoded.
- **No external CLI framework** — args are parsed manually in `src/lib/args.ts`.

## Gotchas

- **Alt screen**: The app takes over the terminal with `\x1b[?1049h`. Crash handlers in `cli.tsx` restore the screen before printing errors — don't add bare `console.log` in hot paths or errors will be swallowed.
- **Click targets** are found by text content in the rendered frame (`lib/click-map.ts`). If you rename visible label strings (e.g. "download" button, footer hints, "try again"), click targets in `app.tsx` must be updated to match.
- **Retry on error**: Pressing Enter in the error phase re-probes the same URL (`lastUrlRef`). The hint reads "↵ try again". If you change error-phase behavior, update both `useInput` and `hintAction`.
- **Temp file cleanup**: `handlePick` has a `finally` block that deletes the probe's temp JSON file (`infoJsonRef`). Don't remove it — without it, `/tmp` accumulates `mediadl-info-*.json` files.
- **yt-dlp progress parsing** uses a custom template with `YOINK|` prefix. The download function splits stdout on this prefix — don't add other stdout lines that start with `YOINK|`.
- **ffmpeg**: `findFfmpeg()` returns `undefined` when ffmpeg is on PATH (yt-dlp finds it itself) and only returns an explicit path for the `ffmpeg-static` fallback. This is intentional.
- **Panel test** sets `FORCE_COLOR=3` and deletes `NO_COLOR` to make Chalk's color support deterministic. Restore env vars in `finally` if you modify this test.
- **tsup config** adds `#!/usr/bin/env node` shebang to the output — `dist/cli.js` is directly executable.
- **Downloads** go to `~/Downloads` with filenames truncated to 60 chars (`%(title).60s.%(ext)s`).
- **spotdl**: Must be installed separately (`pip install spotdl`). The app checks PATH and throws a helpful error if missing. spotdl uses yt-dlp + ffmpeg under the hood.
- **Footer text** uses hardcoded `#52525b` instead of `theme.gray` so it stays dim regardless of theme. Don't change it to `theme.gray`.
