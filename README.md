# mediadl

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
  <img src="assets/logo-light.svg" alt="mediadl" width="288">
</picture>

download media. simple, fast, local.

Download videos from YouTube, X/Twitter, Instagram, Threads, TikTok and
1,800+ other sites — right from your terminal. Download songs and playlists
from Spotify with full metadata. Paste a url, pick a resolution (or
audio-only mp3), done. No popups, no fake download buttons, no sketchy
redirects.

<img src="assets/home.png" alt="mediadl home screen — paste a link and hit download" width="100%">

## Install

```sh
npm install -g mediadl
```

Or try it without installing anything:

```sh
npx mediadl
```

Requires Node 18+. yt-dlp and ffmpeg are fetched or bundled automatically.

### Spotify support

For Spotify downloads, install [spotdl](https://github.com/spotDL/spotify-downloader):

```sh
pip install spotdl
```

## Usage

```sh
$ mediadl https://youtu.be/dQw4w9WgXcQ         # straight to the format picker
$ mediadl https://open.spotify.com/track/...     # download a single track
$ mediadl https://open.spotify.com/playlist/...  # download a full playlist
$ mediadl                                        # prompts for a url
$ mediadl --theme light                          # force the light palette
```

mediadl takes over the terminal (full-screen, centered — and restores your
scrollback on exit). Pick a format with ↑/↓ (or j/k, or number keys) and
hit enter. `esc` goes back, `^c` quits. Or just use the mouse — the download
button, the format list and the footer hints are all clickable, and
clicking the logo takes you back home. Files are saved to `~/Downloads`,
and the file path is printed to your terminal when you're done.

For Spotify URLs, mediadl automatically uses spotdl — single tracks download
directly, playlists show a preview and download all tracks with metadata.

The default `auto` theme uses your terminal's own foreground and background,
so it follows light and dark terminal themes without guessing. Press `^t` or
click the theme control in the footer to cycle through `auto`, `light`, and
`dark` for the current session. Use `--theme auto`, `--theme light`, or
`--theme dark` to choose the starting theme for one launch.

<img src="assets/download-options.png" alt="mediadl format picker — resolutions with estimated file sizes, plus audio-only mp3" width="100%">

## How it works

- For YouTube and 1,800+ sites: powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp). On first run,
  mediadl downloads the standalone yt-dlp binary to `~/.mediadl/bin` —
  no Python required. If you already have yt-dlp installed, it uses yours.
- For Spotify: powered by [spotdl](https://github.com/spotDL/spotify-downloader).
  Install it with `pip install spotdl`. Handles single tracks, playlists,
  and albums with full metadata.
- ffmpeg (needed for merging high-res streams and mp3 extraction) is found
  on your PATH, with `ffmpeg-static` as a bundled fallback.
- The UI is [Ink](https://github.com/vadimdemedes/ink) — React for the
  terminal.

## Development

```sh
npm install
npm run build        # bundle to dist/ with tsup
npm run dev          # rebuild on change
node dist/cli.js <url>
npm run typecheck
```

To try it as a global command without publishing: `npm link`, then run
`mediadl` anywhere.

## Roadmap

- [ ] `--best` / `--mp3` flags to skip the picker (scriptable mode)
- [ ] `-o <dir>` to choose the output folder
- [ ] Playlist / thread-with-multiple-videos support
- [ ] Clipboard detection: launch bare and auto-suggest the url you copied
- [ ] Self-update for the bundled yt-dlp binary (`yt-dlp -U`)
- [x] Publish to npm (`npm i -g mediadl` / `npx mediadl`)
- [ ] `curl mediadl.sh | sh` installer

## A note on fair use

mediadl is a personal-archiving tool. Downloading content may violate a
platform's terms of service — only download what you have the right to
keep, and be excellent to creators.

## Credits

Forked from [yoinks](https://github.com/pablostanley/yoinks) by Pablo Stanley.

## License

[MIT](LICENSE)
