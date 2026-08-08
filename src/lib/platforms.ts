export type Platform = {
  key: string
  label: string
}

const PLATFORMS: Array<{hosts: string[]; platform: Platform}> = [
  {hosts: ['youtube.com', 'youtu.be', 'music.youtube.com'], platform: {key: 'youtube', label: 'YouTube'}},
  {hosts: ['x.com', 'twitter.com'], platform: {key: 'x', label: 'X / Twitter'}},
  {hosts: ['instagram.com'], platform: {key: 'instagram', label: 'Instagram'}},
  {hosts: ['threads.net', 'threads.com'], platform: {key: 'threads', label: 'Threads'}},
  {hosts: ['tiktok.com'], platform: {key: 'tiktok', label: 'TikTok'}},
  {hosts: ['vimeo.com'], platform: {key: 'vimeo', label: 'Vimeo'}},
  {hosts: ['twitch.tv'], platform: {key: 'twitch', label: 'Twitch'}},
  {hosts: ['reddit.com'], platform: {key: 'reddit', label: 'Reddit'}},
  {hosts: ['facebook.com', 'fb.watch'], platform: {key: 'facebook', label: 'Facebook'}},
  {hosts: ['open.spotify.com'], platform: {key: 'spotify', label: 'Spotify'}},
]

export function detectPlatform(url: string): Platform {
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return {key: 'unknown', label: 'Unknown site'}
  }

  for (const {hosts, platform} of PLATFORMS) {
    if (hosts.some(h => hostname === h || hostname.endsWith(`.${h}`))) {
      return platform
    }
  }

  return {key: 'generic', label: hostname}
}

export function isProbablyUrl(input: string): boolean {
  try {
    const u = new URL(input.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function isSpotifyUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.hostname === 'open.spotify.com'
      && /^\/(track|playlist|album|artist)\//.test(u.pathname)
  } catch {
    return false
  }
}

export type SpotifyLinkType = 'track' | 'playlist' | 'album' | 'artist'

export function parseSpotifyUrl(url: string): {type: SpotifyLinkType; id: string} | undefined {
  try {
    const u = new URL(url)
    if (u.hostname !== 'open.spotify.com') return undefined
    const match = /^\/(track|playlist|album|artist)\/([a-zA-Z0-9]+)/.exec(u.pathname)
    if (!match) return undefined
    return {type: match[1] as SpotifyLinkType, id: match[2]!}
  } catch {
    return undefined
  }
}
