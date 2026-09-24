import express from 'express'
import multer from 'multer'
import { create as createYoutubeDl } from 'youtube-dl-exec'
import { mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { existsSync, readFileSync, createWriteStream, createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

// Global crash protection — keep server running under all circumstances
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled Rejection:', reason)
})

const projectRoot = process.cwd()

// Load .env file safely without exposing secrets in code repository
const envFile = join(projectRoot, '.env')
if (existsSync(envFile)) {
  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(envFile)
    } else {
      const content = readFileSync(envFile, 'utf8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIdx = trimmed.indexOf('=')
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim()
            const val = trimmed.slice(eqIdx + 1).trim()
            if (key && process.env[key] === undefined) {
              process.env[key] = val
            }
          }
        }
      }
    }
  } catch {}
}

const app = express()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } })
app.use(express.json())
const port = process.env.PORT || 8787

const getYtDlpPath = () => {
  if (process.env.YT_DLP_PATH && existsSync(process.env.YT_DLP_PATH)) return process.env.YT_DLP_PATH
  if (existsSync('/usr/local/bin/yt-dlp')) return '/usr/local/bin/yt-dlp'
  if (existsSync('/usr/bin/yt-dlp')) return '/usr/bin/yt-dlp'
  if (existsSync('/opt/homebrew/bin/yt-dlp')) return '/opt/homebrew/bin/yt-dlp'
  return 'yt-dlp'
}

const youtubedl = createYoutubeDl(getYtDlpPath())
const runCommand = promisify(execFile)

const getPythonPath = () => {
  if (process.env.PYTHON_PATH && existsSync(process.env.PYTHON_PATH)) return process.env.PYTHON_PATH
  const venvPython = join(projectRoot, '.venv', 'bin', 'python')
  if (existsSync(venvPython)) return venvPython
  const venvPython3 = join(projectRoot, '.venv', 'bin', 'python3')
  if (existsSync(venvPython3)) return venvPython3
  if (existsSync('/opt/aehm-zaehler/.venv/bin/python')) return '/opt/aehm-zaehler/.venv/bin/python'
  return 'python3'
}

const getTranscriptionScript = () => {
  const localScript = join(projectRoot, 'transcribe_local.py')
  if (existsSync(localScript)) return localScript
  if (existsSync('/opt/aehm-zaehler/transcribe_local.py')) return '/opt/aehm-zaehler/transcribe_local.py'
  return localScript
}

const commonYtDlpOptions = {
  noPlaylist: true,
  quiet: true,
  extractorArgs: 'youtube:player_client=android,web',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

const isValidHttpUrl = (urlString) => {
  try {
    const parsed = new URL(urlString)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const hostname = parsed.hostname.toLowerCase()
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.lan') ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
      /^169\.254\./.test(hostname)
    ) {
      return false
    }
    return true
  } catch {
    return false
  }
}

// Result Cache for lightning-fast repeat requests
const analysisResultCache = new Map()
const MAX_CACHE_ENTRIES = 200
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

const getYouTubeVideoId = (url) => {
  if (!url) return null
  const match = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/|live\/))([\w-]{11})/)
  return match ? match[1] : null
}

const getCacheKey = (url, words) => {
  if (!url) return null
  const ytId = getYouTubeVideoId(url)
  const normalizedSource = ytId ? `yt:${ytId}` : String(url).trim().toLowerCase()
  const normalizedWords = [...words].map((w) => String(w).trim().toLowerCase()).sort().join(',')
  return `v3:::${normalizedSource}:::${normalizedWords}`
}

const getFromCache = (url, words) => {
  const key = getCacheKey(url, words)
  if (!key) return null
  const entry = analysisResultCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    analysisResultCache.delete(key)
    return null
  }
  return entry.result
}

const saveToCache = (url, words, result) => {
  const key = getCacheKey(url, words)
  if (!key || !result) return
  if (analysisResultCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = analysisResultCache.keys().next().value
    if (oldestKey) analysisResultCache.delete(oldestKey)
  }
  analysisResultCache.set(key, { result, cachedAt: Date.now() })
}

const parsePodcastRss = (xmlText) => {
  try {
    const channelTitleMatch = xmlText.match(/<channel[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)
    const channelTitle = channelTitleMatch ? channelTitleMatch[1].trim() : ''

    const itemMatch = xmlText.match(/<item[\s\S]*?<\/item>/i)
    if (!itemMatch) return null

    const itemXml = itemMatch[0]
    const itemTitleMatch = itemXml.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)
    const itemTitle = itemTitleMatch ? itemTitleMatch[1].trim() : 'Podcast Episode'

    const enclosureMatch = itemXml.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*>/i)
    const audioUrl = enclosureMatch ? enclosureMatch[1].trim() : null

    const durationMatch = itemXml.match(/<itunes:duration>([^<]+)<\/itunes:duration>/i)
    let duration = 0
    if (durationMatch) {
      const durStr = durationMatch[1].trim()
      if (durStr.includes(':')) {
        const parts = durStr.split(':').map(Number)
        if (parts.length === 3) duration = parts[0] * 3600 + parts[1] * 60 + parts[2]
        else if (parts.length === 2) duration = parts[0] * 60 + parts[1]
      } else {
        duration = Number(durStr) || 0
      }
    }

    const imageMatch = itemXml.match(/<itunes:image[^>]*href=["']([^"']+)["']/i) || xmlText.match(/<image[\s\S]*?<url>([^<]+)<\/url>/i)
    const thumbnail = imageMatch ? imageMatch[1].trim() : ''

    return {
      title: itemTitle,
      uploader: channelTitle || 'Podcast',
      duration,
      thumbnail,
      audioUrl,
    }
  } catch (e) {
    console.warn('[podcast] RSS parse note:', e?.message)
    return null
  }
}

const resolveSpotifyPodcast = async (url) => {
  try {
    const decodedUrl = decodeURIComponent(url)
    const epMatch = decodedUrl.match(/spotify\.com\/(episode|show|track)\/([^/?#&]+)/i) || decodedUrl.match(/spotify:(episode|show|track):([^/?#&]+)/i)
    if (!epMatch) return null
    
    const type = epMatch[1].toLowerCase()
    let epId = epMatch[2].trim()
    if (epId.includes('_') || epId.includes(':')) {
      epId = epId.split(/[_:]/)[0]
    }
    console.log(`[spotify] Resolving clean Spotify ${type} ID:`, epId)

    let title = ''
    let showName = ''
    let duration = 0
    let thumbnail = ''

    // Method 1: Try Spotify embed page (Next.js data)
    try {
      const embedRes = await fetch(`https://open.spotify.com/embed/${type}/${epId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(8000)
      })
      if (embedRes.ok) {
        const html = await embedRes.text()
        const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s) || html.match(/{"props":[\s\S]*?"audioPreview"[\s\S]*?}/)
        if (match) {
          try {
            const json = JSON.parse(match[1] || match[0])
            const entity = json?.props?.pageProps?.state?.data?.entity
            if (entity) {
              title = entity.title || entity.name || ''
              showName = entity.subtitle || (type === 'show' ? (entity.name || entity.title || '') : '')
              duration = Math.round(Number(entity.duration || 0) / 1000)
              if (entity.coverArt?.sources?.[0]?.url) {
                thumbnail = entity.coverArt.sources[0].url
              }
            }
          } catch (e) {
            console.warn('[spotify] Embed JSON parse error:', e?.message)
          }
        }
      }
    } catch (e) {
      console.warn('[spotify] Embed fetch note:', e?.message)
    }

    // Method 2: Try Direct Page with Facebook Bot UA (Spotify returns rich OpenGraph tags for FB bot)
    if (!title || !showName) {
      try {
        const fbRes = await fetch(`https://open.spotify.com/${type}/${epId}`, {
          headers: {
            'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
          },
          signal: AbortSignal.timeout(8000)
        })
        if (fbRes.ok) {
          const html = await fbRes.text()
          const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/i)?.[1]
          const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/i)?.[1]
          const ogImg = html.match(/<meta property="og:image" content="([^"]+)"/i)?.[1]
          
          if (ogTitle && !ogTitle.includes('Spotify')) {
            title = ogTitle
          }
          if (ogDesc && ogDesc.includes('·')) {
            const parts = ogDesc.split('·').map(s => s.trim())
            if (parts.length >= 2) {
              showName = parts[1]
            }
          } else if (type === 'show' && ogTitle) {
            showName = ogTitle
          }
          if (!thumbnail && ogImg) {
            thumbnail = ogImg
          }
        }
      } catch (e) {
        console.warn('[spotify] FB Bot fetch note:', e?.message)
      }
    }

    console.log('[spotify] Extracted title:', title, '| showName:', showName, '| duration:', duration)

    // Method 3: Resolve Direct MP3 from iTunes / Podcast RSS Feed
    if (showName || title) {
      const searchQueries = [
        showName,
        title.split('-')[0].trim(),
        title.replace(/#\d+/g, '').trim()
      ].filter(Boolean)

      for (const query of searchQueries) {
        try {
          console.log('[spotify] Trying iTunes search for podcast:', query)
          const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=podcast&limit=5`, {
            signal: AbortSignal.timeout(8000)
          })
          if (itunesRes.ok) {
            const data = await itunesRes.json()
            const feedUrl = data.results?.[0]?.feedUrl
            if (feedUrl) {
              console.log('[spotify] Found Podcast RSS:', feedUrl)
              const rssRes = await fetch(feedUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(12000)
              })
              if (rssRes.ok) {
                const xml = await rssRes.text()
                const items = xml.match(/<item[\s\S]*?<\/item>/gi) || []

                const epNumMatch = title.match(/(?:#|Nr\.?|Ep\.?|Folge\s*)(\d+)/i)
                const epNum = epNumMatch ? epNumMatch[1] : null
                const cleanTitle = title.replace(/#\d+/g, '').replace(/[^\w\s]/g, '').trim().toLowerCase()

                for (const item of items) {
                  const itemTitleMatch = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i)
                  const itemTitle = (itemTitleMatch ? itemTitleMatch[1] : '').trim()
                  const audioMatch = item.match(/<enclosure[^>]+url="([^"]+)"/i)
                  const audioUrl = audioMatch ? audioMatch[1] : ''

                  if (!audioUrl) continue

                  let isMatch = false
                  if (type === 'show') {
                    isMatch = true
                  } else if (epNum && itemTitle.includes(epNum)) {
                    isMatch = true
                  } else if (cleanTitle.length > 3) {
                    const cleanItemTitle = itemTitle.replace(/[^\w\s]/g, '').toLowerCase()
                    if (cleanItemTitle.includes(cleanTitle) || cleanTitle.includes(cleanItemTitle)) {
                      isMatch = true
                    }
                  }

                  if (isMatch) {
                    console.log('[spotify] DIRECT MP3 FOUND:', audioUrl)
                    return {
                      title: showName ? `${showName} – ${itemTitle}` : itemTitle,
                      uploader: showName || 'Podcast',
                      duration: duration || 0,
                      thumbnail,
                      directAudioUrl: audioUrl
                    }
                  }
                }
              }
            }
          }
        } catch (e) {
          console.warn('[spotify] iTunes error for query', query, e?.message)
        }
      }
    }

    return {
      title: showName ? `${showName} – ${title}` : title || 'Spotify Episode',
      uploader: showName || 'Spotify',
      duration: duration || 0,
      thumbnail
    }
  } catch (err) {
    console.warn('[spotify] Resolution error:', err?.message)
    return null
  }
}

const getUrlMetadata = async (url) => {
  if (!isValidHttpUrl(url)) {
    throw new Error('Ungültige oder nicht erlaubte URL.')
  }

  let title = ''
  let uploader = ''
  let duration = 0
  let thumbnail = ''
  let directAudioUrl = ''

  const lowerUrl = url.toLowerCase()

  // 1. Spotify Podcast Episode Resolution
  if (lowerUrl.includes('spotify.com')) {
    const spotifyData = await resolveSpotifyPodcast(url)
    if (spotifyData) {
      return spotifyData
    }
  }

  // 2. Direct Audio File (.mp3, .wav, .m4a, .aac, .ogg, .flac)
  if (/\.(mp3|wav|m4a|aac|ogg|flac)(\?.*)?$/i.test(lowerUrl)) {
    const filename = url.split('/').pop()?.split('?')[0] || 'Audiodatei'
    title = decodeURIComponent(filename)
    uploader = new URL(url).hostname
    directAudioUrl = url
    return { title, uploader, duration: 0, thumbnail: '', directAudioUrl }
  }

  // 3. Podcast RSS Feed (.xml, .rss, /feed, /podcast)
  if (lowerUrl.includes('.rss') || lowerUrl.includes('.xml') || lowerUrl.includes('/feed') || lowerUrl.includes('podcast')) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const text = await res.text()
        if (text.includes('<rss') || text.includes('<channel')) {
          const podcastInfo = parsePodcastRss(text)
          if (podcastInfo && podcastInfo.audioUrl) {
            return {
              title: podcastInfo.title,
              uploader: podcastInfo.uploader,
              duration: podcastInfo.duration,
              thumbnail: podcastInfo.thumbnail,
              directAudioUrl: podcastInfo.audioUrl,
            }
          }
        }
      }
    } catch (rssErr) {
      console.warn('[metadata] RSS fetch note:', rssErr?.message)
    }
  }

  // 4. Fast oEmbed for YouTube
  if (/(?:youtu\.be\/|youtube\.com\/)/i.test(url)) {
    try {
      const oeRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
      if (oeRes.ok) {
        const oeData = await oeRes.json()
        if (oeData?.title) {
          title = oeData.title
          uploader = oeData.author_name || ''
          thumbnail = oeData.thumbnail_url || ''
        }
      }
    } catch (oeErr) {
      console.warn('[metadata] oembed fetch error:', oeErr?.message)
    }
  }

  try {
    const metadata = await youtubedl(url, {
      ...commonYtDlpOptions,
      dumpSingleJson: true,
      noDownload: true,
    }, { timeout: 2 * 60 * 1000 })

    duration = Number(metadata.duration || 0)
    if (!title) title = String(metadata.title || '').trim()
    if (!uploader) uploader = String(metadata.uploader || metadata.channel || '').trim()
    if (!thumbnail) thumbnail = String(metadata.thumbnail || '').trim()
  } catch (ytErr) {
    console.warn('[metadata] yt-dlp note:', ytErr?.message)
  }

  return {
    duration,
    title,
    uploader,
    thumbnail,
  }
}

const tokenizeText = (text) => String(text || '').toLocaleLowerCase('de-DE').match(/[\p{L}\p{N}]+/gu) || []

const countWordOccurrences = (text, word) => {
  const tokens = tokenizeText(text)
  const searchTokens = tokenizeText(word)
  if (!searchTokens.length) return 0

  let matches = 0
  for (let index = 0; index <= tokens.length - searchTokens.length; index += 1) {
    if (searchTokens.every((token, offset) => tokens[index + offset] === token)) matches += 1
  }
  return matches
}

const countSegmentWords = (text, words) => {
  const tokens = tokenizeText(text)
  const result = {}
  for (const word of words) {
    const searchTokens = tokenizeText(word)
    if (!searchTokens.length) {
      result[word] = 0
      continue
    }
    let matches = 0
    for (let index = 0; index <= tokens.length - searchTokens.length; index += 1) {
      if (searchTokens.every((token, offset) => tokens[index + offset] === token)) matches += 1
    }
    result[word] = matches
  }
  return result
}

const getPhraseOverlap = (words, counts) => {
  const singleWordsSet = new Set(
    words
      .filter((word) => !word.trim().includes(' '))
      .flatMap((word) => word.toLocaleLowerCase('de-DE').match(/[\p{L}\p{N}]+/gu) || [])
  )

  let overlap = 0
  for (const word of words) {
    if (!word.trim().includes(' ')) continue
    const phraseTokens = word.toLocaleLowerCase('de-DE').match(/[\p{L}\p{N}]+/gu) || []
    const matchingSingleTokensCount = phraseTokens.filter((token) => singleWordsSet.has(token)).length
    if (matchingSingleTokensCount > 0) {
      overlap += matchingSingleTokensCount * (counts[word] || 0)
    }
  }
  return overlap
}

const SPEAKER_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4']

const extractSpeakerNamesFromTranscript = (segments) => {
  const earlySegments = (segments || []).filter((s) => Number(s.start || 0) <= 180)
  const fullEarlyText = earlySegments.map((s) => String(s.text || '')).join(' ')
  const detected = []

  const patterns = [
    /(?:mein name ist|ich bin|hier ist|ich heiße)\s+([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)?)/gi,
    /(?:mein gast (?:heute|ist)?|begrüße (?:ganz herzlich)?|zusammen mit|mit dabei ist)\s+([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)?)/gi,
    /(?:herzlich willkommen (?:bei|zu|an)|hallo zusammen,? ich bin)\s+([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)?)/gi,
    /(?:und an meiner seite|heute zugeschaltet ist)\s+([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)?)/gi,
  ]

  const stopWords = ['ein', 'eine', 'einer', 'sehr', 'wieder', 'heute', 'jetzt', 'hier', 'auch', 'noch', 'podcast', 'video', 'kanal', 'show', 'deutschland', 'folge', 'thema']

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(fullEarlyText)) !== null) {
      const candidate = match[1]?.trim()
      if (candidate && candidate.length > 2 && !stopWords.includes(candidate.toLowerCase()) && !detected.includes(candidate)) {
        detected.push(candidate)
      }
    }
  }

  return detected
}

const cleanHallucinatedRepetitions = (text) => {
  return String(text || '').replace(/\b(\w+)(?:\s+\1){2,}\b/gi, '$1 $1').trim()
}

const performSpeakerDiarization = (rawSegments, words) => {
  if (!rawSegments || !rawSegments.length) return { segments: [], speakers: {} }

  const detectedNames = extractSpeakerNamesFromTranscript(rawSegments)
  const name1 = detectedNames[0] || 'Sprecher 1'
  const name2 = detectedNames[1] || (detectedNames.length === 1 ? 'Gast / Co-Host' : 'Sprecher 2')

  // 1. Acoustic Pitch Analysis for Voice Separation
  const validPitches = rawSegments
    .map((s) => Number(s.pitch || 0))
    .filter((p) => p >= 75 && p <= 360)
    .sort((a, b) => a - b)

  let usePitchClustering = false
  let pitchCenter1 = 0
  let pitchCenter2 = 0
  let pitchThreshold = 165

  if (validPitches.length >= 4) {
    const q25 = validPitches[Math.floor(validPitches.length * 0.25)]
    const q75 = validPitches[Math.floor(validPitches.length * 0.75)]
    const spread = q75 - q25

    if (spread >= 24) {
      usePitchClustering = true
      const lowerHalf = validPitches.slice(0, Math.floor(validPitches.length / 2))
      const upperHalf = validPitches.slice(Math.floor(validPitches.length / 2))
      pitchCenter1 = lowerHalf[Math.floor(lowerHalf.length / 2)] || q25
      pitchCenter2 = upperHalf[Math.floor(upperHalf.length / 2)] || q75
      pitchThreshold = (pitchCenter1 + pitchCenter2) / 2
      console.log(`[Diarization] Detected 2 distinct voice pitch clusters: ${pitchCenter1.toFixed(1)} Hz vs ${pitchCenter2.toFixed(1)} Hz (Threshold: ${pitchThreshold.toFixed(1)} Hz, Spread: ${spread.toFixed(1)} Hz)`)
    }
  }

  const turnMarkers = [
    /^(?:ja|nein|genau|stimmt|absolut|danke|vielen dank|hallo|guten tag|guten morgen|guten abend|servus|moin|auf jeden fall|interessant|frage|was meinst du|wie siehst du|ich glaube|wir haben|übergebe|herzlich willkommen|schönen guten|okay|alles klar|richtig)/i,
    /(?:\?|\!)$/
  ]

  let currentSpeakerIdx = 0
  let isMultiSpeaker = usePitchClustering || detectedNames.length > 1
  let speakerTurnCount = 0

  const enrichedSegments = []

  rawSegments.forEach((s, idx) => {
    const segStart = Number(s.start || 0)
    const segEnd = Number(s.end || 0)
    const segText = cleanHallucinatedRepetitions(s.text)
    const segPitch = Number(s.pitch || 0)
    const segWordCount = segText ? segText.split(/\s+/).length : 0
    const segDurationMin = Math.max(0.01, (segEnd - segStart) / 60)
    const wpm = Math.round(segWordCount / segDurationMin)

    if (usePitchClustering) {
      if (segPitch >= 75 && segPitch <= 360) {
        const decidedIdx = segPitch < pitchThreshold ? 0 : 1
        if (decidedIdx !== currentSpeakerIdx) {
          currentSpeakerIdx = decidedIdx
          speakerTurnCount++
        }
      }
      // If unvoiced/pitch 0: preserve currentSpeakerIdx (do NOT alternate on pauses)
    } else if (detectedNames.length > 1 && idx > 0) {
      const prevEnd = Number(rawSegments[idx - 1].end || 0)
      const prevText = String(rawSegments[idx - 1].text || '').trim()
      const gap = segStart - prevEnd

      const prevHasQuestion = prevText.endsWith('?')
      const currentHasTurnCue = turnMarkers[0].test(segText)
      
      if (gap >= 2.0 && (prevHasQuestion || currentHasTurnCue)) {
        currentSpeakerIdx = currentSpeakerIdx === 0 ? 1 : 0
        speakerTurnCount++
        isMultiSpeaker = true
      }
    }

    const speakerId = isMultiSpeaker ? `speaker_${currentSpeakerIdx + 1}` : 'speaker_1'
    const speakerName = speakerId === 'speaker_1' ? name1 : name2

    enrichedSegments.push({
      start: segStart,
      end: segEnd,
      text: segText,
      pitch: segPitch,
      words: s.words || [],
      counts: countSegmentWords(segText, words),
      wpm: isNaN(wpm) ? 0 : Math.min(300, Math.max(0, wpm)),
      speakerId,
      speakerName,
    })
  })

  // Aggregate speaker stats
  const speakers = {}
  enrichedSegments.forEach((s) => {
    const spId = s.speakerId || 'speaker_1'
    if (!speakers[spId]) {
      const idx = spId === 'speaker_1' ? 0 : 1
      speakers[spId] = {
        id: spId,
        name: s.speakerName || `Sprecher ${idx + 1}`,
        color: SPEAKER_COLORS[idx % SPEAKER_COLORS.length],
        totalWords: 0,
        fillerWords: 0,
        baseFillerWords: 0,
        relativeRate: 0,
        duration: 0,
        wpm: 0,
        counts: Object.fromEntries(words.map((w) => [w, 0])),
      }
    }

    const wordsInSeg = s.text.trim() ? s.text.trim().split(/\s+/).length : 0
    const segDur = Math.max(0, s.end - s.start)
    speakers[spId].totalWords += wordsInSeg
    speakers[spId].duration += segDur

    if (s.counts) {
      Object.entries(s.counts).forEach(([w, count]) => {
        if (speakers[spId].counts[w] !== undefined) {
          speakers[spId].counts[w] += Number(count)
        }
      })
    }
  })

  // Calculate rates & WPM for each speaker
  Object.values(speakers).forEach((sp) => {
    sp.fillerWords = Object.values(sp.counts).reduce((a, b) => a + b, 0)
    sp.baseFillerWords = sp.fillerWords
    sp.relativeRate = sp.totalWords > 0 ? (sp.fillerWords / sp.totalWords) * 100 : 0
    sp.wpm = sp.duration > 0 ? Math.round((sp.totalWords / (sp.duration / 60))) : 0
    sp.duration = Math.round(sp.duration * 10) / 10
  })

  return { segments: enrichedSegments, speakers }
}

app.post('/api/media-info', async (request, response) => {
  try {
    const url = String(request.body.url || '').trim()
    if (!url) return response.status(400).json({ error: 'Kein Medienlink angegeben.' })
    if (!isValidHttpUrl(url)) return response.status(400).json({ error: 'Ungültige oder nicht erlaubte URL.' })

    const info = await getUrlMetadata(url)
    if (!info.duration && !info.title) {
      return response.status(422).json({ error: 'Die Metadaten konnten nicht aus dem Link gelesen werden.' })
    }

    return response.json(info)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Medienmetadaten konnten nicht geladen werden.'
    console.error('Metadaten konnten nicht geladen werden:', message)
    return response.status(400).json({ error: message })
  }
})

const activeJobs = new Map()

// Queue Management for Concurrency Control
const MAX_CONCURRENT_ANALYSES = 1
let activeAnalysisCount = 0
const analysisQueue = []

const notifyQueuePositions = () => {
  analysisQueue.forEach((item, index) => {
    if (item.sendEvent && !item.isAborted) {
      item.sendEvent({
        type: 'queue',
        queuePosition: index + 1,
        queueLength: analysisQueue.length,
        message: `Server ausgelastet. Du bist in der Warteschlange (Position ${index + 1} von ${analysisQueue.length})...`,
      })
    }
  })
}

const processNextInQueue = () => {
  if (activeAnalysisCount >= MAX_CONCURRENT_ANALYSES || analysisQueue.length === 0) return
  const nextJob = analysisQueue.shift()
  notifyQueuePositions()
  if (nextJob && !nextJob.isAborted) {
    activeAnalysisCount += 1
    nextJob.start()
  } else if (nextJob && nextJob.isAborted) {
    processNextInQueue()
  }
}

const releaseAnalysisSlot = () => {
  activeAnalysisCount = Math.max(0, activeAnalysisCount - 1)
  processNextInQueue()
}

// Clean up old jobs every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [id, job] of activeJobs.entries()) {
    if (now - job.updatedAt > 30 * 60 * 1000) {
      activeJobs.delete(id)
    }
  }
}, 5 * 60 * 1000)

app.get('/api/health', (request, response) => {
  return response.json({ ok: true, uptime: process.uptime(), activeJobs: activeJobs.size })
})

app.get('/api/analyze-status/:id', (request, response) => {
  const id = request.params.id
  const job = activeJobs.get(id)
  if (!job) {
    return response.json({
      id,
      status: 'initializing',
      stage: 'init',
      message: 'Initialisiere Analyse...',
      percent: 5,
      segments: [],
      counts: {},
    })
  }
  return response.json(job)
})

app.get('/api/audio-stream/:id', async (request, response) => {
  try {
    const id = request.params.id
    const job = activeJobs.get(id)
    if (!job || !job.audioPath || !existsSync(job.audioPath)) {
      return response.status(404).json({ error: 'Audiodatei nicht gefunden.' })
    }

    const filePath = job.audioPath
    const stats = await stat(filePath)
    const range = request.headers.range

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1
      const chunksize = end - start + 1
      const fileStream = createReadStream(filePath, { start, end })
      response.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'audio/mpeg',
      })
      fileStream.pipe(response)
    } else {
      response.writeHead(200, {
        'Content-Length': stats.size,
        'Content-Type': 'audio/mpeg',
        'Accept-Ranges': 'bytes',
      })
      createReadStream(filePath).pipe(response)
    }
  } catch (err) {
    console.error('[audio-stream] Error:', err?.message)
    if (!response.headersSent) {
      response.status(500).json({ error: 'Stream-Fehler' })
    }
  }
})

const killProcessTree = (child) => {
  if (!child) return
  try {
    if (child.pid) {
      process.kill(child.pid, 'SIGKILL')
    }
  } catch {}
  try {
    child.kill('SIGKILL')
  } catch {}
}

app.post('/api/analyze-cancel/:id', (request, response) => {
  const id = request.params.id
  console.log('[analyze] Cancel requested for job:', id)
  const job = activeJobs.get(id)
  if (job) {
    job.status = 'aborted'
    if (job.childProcess) {
      killProcessTree(job.childProcess)
      job.childProcess = null
    }
  }
  // Also remove from queue if present
  const queueIdx = analysisQueue.findIndex((q) => q.jobId === id)
  if (queueIdx !== -1) {
    const [removed] = analysisQueue.splice(queueIdx, 1)
    if (removed) removed.isAborted = true
    notifyQueuePositions()
  }
  return response.json({ ok: true })
})

app.post('/api/analyze', upload.single('file'), async (request, response) => {
  request.body = request.body || {}
  let temporaryDirectory
  let childProcess = null
  let isAborted = false
  let heartbeat = null
  let isSlotAcquired = false

  const jobId = String(request.body.jobId || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`)
  const jobState = {
    id: jobId,
    status: 'running',
    stage: 'download',
    message: 'Initialisiere Analyse...',
    percent: 5,
    currentTime: 0,
    duration: 0,
    counts: {},
    fillerWords: 0,
    baseFillerWords: 0,
    totalWords: 0,
    relativeRate: 0,
    text: '',
    segments: [],
    result: null,
    error: null,
    updatedAt: Date.now(),
  }
  activeJobs.set(jobId, jobState)

  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform, no-store, must-revalidate',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  if (typeof response.flushHeaders === 'function') response.flushHeaders()
  if (request.socket) {
    try {
      request.socket.setNoDelay(true)
      request.socket.setKeepAlive(true, 1000)
    } catch {}
  }

  // 64KB initial burst padding to bypass any proxy buffer (Nginx/Cloudflare/Apache)
  response.write(': ' + ' '.repeat(65536) + '\n\n')
  response.write(`data: ${JSON.stringify({ type: 'init', jobId })}\n\n: ${' '.repeat(2048)}\n\n`)

  heartbeat = setInterval(() => {
    if (!response.writableEnded && !isAborted) {
      response.write(': ping ' + Date.now() + '\n\n')
    }
  }, 1500)

  const sendEvent = (data) => {
    jobState.updatedAt = Date.now()
    if (data.type === 'status') {
      jobState.stage = data.stage || jobState.stage
      jobState.message = data.message || jobState.message
    } else if (data.type === 'queue') {
      jobState.stage = 'queue'
      jobState.queuePosition = data.queuePosition
      jobState.message = data.message
    } else if (data.type === 'progress') {
      jobState.stage = 'transcribing'
      jobState.percent = data.percent || jobState.percent
      jobState.currentTime = data.currentTime || jobState.currentTime
      jobState.duration = data.duration || jobState.duration
      jobState.counts = data.counts || jobState.counts
      jobState.fillerWords = data.fillerWords || jobState.fillerWords
      jobState.baseFillerWords = data.baseFillerWords || jobState.baseFillerWords
      jobState.totalWords = data.totalWords || jobState.totalWords
      jobState.relativeRate = data.relativeRate || jobState.relativeRate
      jobState.text = data.partialText || jobState.text
      jobState.segments = data.segments || jobState.segments
    } else if (data.type === 'complete') {
      jobState.status = 'complete'
      jobState.result = data.result
      jobState.percent = 100
      jobState.message = 'Ergebnis fertig'
    } else if (data.type === 'error') {
      jobState.status = 'error'
      jobState.error = data.error
    }

    if (response.writableEnded || isAborted) return
    const json = JSON.stringify(data)
    response.write(`data: ${json}\n\n: ${' '.repeat(2048)}\n\n`)
  }

  request.on('close', () => {
    if (heartbeat) clearInterval(heartbeat)
    // Keep job processing in background so status polling (/api/analyze-status/:id) can receive the result.
    // Explicit cancel is handled via /api/analyze-cancel/:id.
  })

  const runAnalysis = async () => {
    isSlotAcquired = true
    try {
      console.log('[analyze] Starting job execution for:', jobId)
      if (request.body.url && !isValidHttpUrl(request.body.url)) {
        throw new Error('Ungültige oder nicht erlaubte Medien-URL.')
      }

      const words = JSON.parse(request.body.words || '[]').map((word) => word.trim().toLowerCase()).filter(Boolean)
      console.log('[analyze] Words to search:', words)

      // 1. Instant Cache Check for repeat URLs
      if (request.body.url) {
        const cached = getFromCache(request.body.url, words)
        if (cached) {
          console.log('[analyze] ⚡ Cache HIT for URL:', request.body.url)
          sendEvent({ type: 'status', stage: 'download', message: '⚡ Blitzschnell aus Cache geladen...' })
          sendEvent({
            type: 'progress',
            percent: 50,
            currentTime: (cached.duration || 10) / 2,
            duration: cached.duration || 10,
            counts: cached.counts || {},
            fillerWords: cached.fillerWords || 0,
            baseFillerWords: cached.baseFillerWords || 0,
            totalWords: cached.totalWords || 0,
            relativeRate: cached.relativeRate || 0,
            partialText: (cached.text || '').slice(0, 100),
            segments: (cached.segments || []).slice(0, Math.ceil((cached.segments || []).length / 2)),
          })
          sendEvent({
            type: 'complete',
            result: cached,
          })
          return response.end()
        }
      }

      temporaryDirectory = await mkdtemp(join(tmpdir(), 'aehmzaehler-'))
      console.log('[analyze] Temp dir:', temporaryDirectory)

      let file = request.file
      let mediaTitle = request.body.title ? String(request.body.title).trim() : ''
      if (file && !mediaTitle) {
        mediaTitle = file.originalname
      }

      if (!file && request.body.url) {
        console.log('[analyze] Downloading from URL:', request.body.url)
        sendEvent({ type: 'status', stage: 'download', message: 'Lade Video / Podcast / Audio herunter...' })

        let metadataInfo = null
        try {
          metadataInfo = await getUrlMetadata(request.body.url)
          if (metadataInfo?.title && !mediaTitle) {
            mediaTitle = metadataInfo.title
            jobState.mediaTitle = mediaTitle
            sendEvent({ type: 'status', stage: 'download', message: `Lade „${mediaTitle}“ herunter...`, mediaTitle })
          }
        } catch (tErr) {
          console.log('[analyze] Metadata fetch note:', tErr?.message)
        }

        let rawFilePath = null

        if (metadataInfo?.directAudioUrl) {
          console.log('[analyze] Direct audio/podcast stream detected:', metadataInfo.directAudioUrl)
          sendEvent({ type: 'status', stage: 'download', message: `Lade Audio „${mediaTitle || 'Podcast'}“ direkt...` })
          const audioRes = await fetch(metadataInfo.directAudioUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(120000),
          })
          if (!audioRes.ok) throw new Error(`Audio-Download fehlgeschlagen (HTTP ${audioRes.status})`)
          rawFilePath = join(temporaryDirectory, 'direct-audio.mp3')
          const writeStream = createWriteStream(rawFilePath)
          await pipeline(Readable.fromWeb(audioRes.body), writeStream)
          const audioStats = await stat(rawFilePath)
          console.log('[analyze] Direct audio downloaded to disk, size:', audioStats.size)
          file = { path: rawFilePath, originalname: `${mediaTitle || 'audio'}.mp3`, mimetype: 'audio/mpeg', size: audioStats.size }
        } else {
          const output = join(temporaryDirectory, 'audio.%(ext)s')
          
          if (request.body.url.toLowerCase().includes('spotify.com') && !metadataInfo?.directAudioUrl) {
            const searchTitle = metadataInfo?.title || 'Spotify Podcast'
            if (!metadataInfo?.title) {
              throw new Error('Spotify-DRM: Diese Spotify-Folge ist kopiergeschützt und konnte keinem offenen Podcast-Feed zugeordnet werden. Bitte lade die MP3-Datei direkt hoch oder nutze einen YouTube-Link.')
            }
            console.log('[analyze] Spotify fallback to YouTube search:', searchTitle)
            sendEvent({ type: 'status', stage: 'download', message: `Suche „${searchTitle}“ auf YouTube...` })
            try {
              await youtubedl(`ytsearch1:${searchTitle}`, {
                ...commonYtDlpOptions,
                extractAudio: true,
                audioFormat: 'mp3',
                output,
              }, { timeout: 10 * 60 * 1000 })
            } catch (ytSearchErr) {
              console.error('[analyze] Spotify ytsearch failed:', ytSearchErr?.message)
              throw new Error('Spotify-DRM: Die Spotify-Folge konnte nicht über offene Podcast-Quellen heruntergeladen werden. Bitte lade die Audiodatei direkt als MP3/M4A hoch.')
            }
          } else {
            try {
              await youtubedl(request.body.url, {
                ...commonYtDlpOptions,
                extractAudio: true,
                audioFormat: 'mp3',
                output,
              }, { timeout: 10 * 60 * 1000 })
            } catch (dlErr) {
              const msg = dlErr instanceof Error ? dlErr.message : String(dlErr)
              console.error('[analyze] yt-dlp Fehler:', msg)
              throw new Error(`Download fehlgeschlagen: ${msg.split('\n')[0]}`)
            }
          }

          const dirFiles = await readdir(temporaryDirectory)
          const downloadedFileName = dirFiles.find((f) => f.startsWith('audio.'))
          if (!downloadedFileName) {
            throw new Error('Die heruntergeladene Audiodatei konnte im temporären Verzeichnis nicht gefunden werden.')
          }
          rawFilePath = join(temporaryDirectory, downloadedFileName)
          const dlStats = await stat(rawFilePath)
          file = { path: rawFilePath, originalname: 'linked-media.mp3', mimetype: 'audio/mpeg', size: dlStats.size }
          console.log('[analyze] Download complete, file:', downloadedFileName, 'size:', dlStats.size)
        }
      }

      if (!file) {
        sendEvent({ type: 'error', error: 'Bitte eine Datei oder einen Link angeben.' })
        return response.end()
      }

      const workingAudioPath = join(temporaryDirectory, 'prepared-audio.mp3')
      const inputPath = join(temporaryDirectory, 'input-media')

      if (file.buffer) {
        await writeFile(inputPath, file.buffer)
        console.log('[analyze] Uploaded file saved to disk, size:', file.buffer.length)
      } else if (file.path) {
        // file is already at file.path on disk
      }

      const sourceAudioFile = file.path || inputPath
      console.log('[analyze] Converting & optimizing audio for Whisper KI from:', sourceAudioFile)
      sendEvent({ type: 'status', stage: 'converting', message: 'Optimiere Audio für Whisper KI...' })
      await runCommand('ffmpeg', ['-y', '-i', sourceAudioFile, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', workingAudioPath], { timeout: 10 * 60 * 1000 })
      jobState.audioPath = workingAudioPath

      const pythonPath = getPythonPath()
      const scriptPath = getTranscriptionScript()
      console.log('[analyze] Using Python:', pythonPath, 'exists:', existsSync(pythonPath))
      console.log('[analyze] Using Script:', scriptPath, 'exists:', existsSync(scriptPath))

      sendEvent({ type: 'status', stage: 'transcribing', message: 'Whisper KI transkribiert Audio...' })

      await new Promise((resolve, reject) => {
        let duration = 0
        const segments = []
        const textParts = []
        let stdoutBuffer = ''
        let stderrBuffer = ''

        childProcess = spawn(pythonPath, [scriptPath, workingAudioPath, words.join(',')])
        jobState.childProcess = childProcess

        childProcess.stdout.on('data', (chunk) => {
          stdoutBuffer += chunk.toString()
          const lines = stdoutBuffer.split('\n')
          stdoutBuffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            try {
              const data = JSON.parse(trimmed)
              if (data.type === 'info') {
                duration = Number(data.duration || 0)
                sendEvent({
                  type: 'progress',
                  percent: 2,
                  currentTime: 0,
                  duration,
                  counts: Object.fromEntries(words.map((w) => [w, 0])),
                  fillerWords: 0,
                  baseFillerWords: 0,
                  totalWords: 0,
                  relativeRate: 0,
                  partialText: '',
                  segments: [],
                })
              } else if (data.type === 'segment' && data.segment) {
                const seg = {
                  start: Number(data.segment.start || 0),
                  end: Number(data.segment.end || 0),
                  text: String(data.segment.text || ''),
                  counts: countSegmentWords(String(data.segment.text || ''), words),
                }
                segments.push(seg)
                textParts.push(seg.text)
                console.log('[analyze] Segment (', seg.start.toFixed(1), 's -', seg.end.toFixed(1), 's):', seg.text)

                const currentText = textParts.join(' ')
                const counts = Object.fromEntries(words.map((word) => [word, countWordOccurrences(currentText, word)]))
                const fillerWords = Object.values(counts).reduce((sum, count) => sum + count, 0)
                const phraseOverlap = getPhraseOverlap(words, counts)
                const baseFillerWords = Math.max(0, fillerWords - phraseOverlap)
                const totalWords = currentText.trim() ? currentText.trim().split(/\s+/).length : 0
                const relativeRate = totalWords ? baseFillerWords / totalWords : 0
                const percent = duration > 0 ? Math.min(99, Math.max(5, Math.round((seg.end / duration) * 100))) : 50

                sendEvent({
                  type: 'progress',
                  percent,
                  currentTime: seg.end,
                  duration,
                  counts,
                  fillerWords,
                  baseFillerWords,
                  totalWords,
                  relativeRate,
                  partialText: currentText,
                  segment: seg,
                  segments,
                })
              } else if (data.type === 'done') {
                const text = String(data.text || textParts.join(' '))
                const finalDuration = Number(data.duration || duration)
                const counts = Object.fromEntries(words.map((word) => [word, countWordOccurrences(text, word)]))
                const fillerWords = Object.values(counts).reduce((sum, count) => sum + count, 0)
                const phraseOverlap = getPhraseOverlap(words, counts)
                const baseFillerWords = Math.max(0, fillerWords - phraseOverlap)
                const totalWords = text.trim() ? text.trim().split(/\s+/).length : 0
                const relativeRate = totalWords ? baseFillerWords / totalWords : 0
                const rawSegments = Array.isArray(data.segments) && data.segments.length > 0 ? data.segments : segments

                // Perform speaker diarization, name extraction, pauses and WPM
                const { segments: finalSegments, speakers } = performSpeakerDiarization(rawSegments, words)

                let pauseCount = 0
                let totalPauseSeconds = 0
                for (let idx = 1; idx < finalSegments.length; idx++) {
                  const prevEnd = Number(finalSegments[idx - 1].end || 0)
                  const segStart = Number(finalSegments[idx].start || 0)
                  const gap = segStart - prevEnd
                  if (gap >= 1.2) {
                    pauseCount += 1
                    totalPauseSeconds += gap
                  }
                }

                console.log('[analyze] Complete! Total words:', totalWords, 'Fillers:', fillerWords, 'Segments:', finalSegments.length, 'Speakers:', Object.keys(speakers).length, 'Pauses:', pauseCount)
                const completeResult = {
                  text,
                  duration: finalDuration,
                  counts,
                  fillerWords,
                  baseFillerWords,
                  totalWords,
                  relativeRate,
                  segments: finalSegments,
                  speakers,
                  pauseCount,
                  totalPauseSeconds: Math.round(totalPauseSeconds * 10) / 10,
                  mediaTitle: mediaTitle || (file ? file.originalname : ''),
                  directAudioUrl: metadataInfo?.directAudioUrl || '',
                  audioUrl: metadataInfo?.directAudioUrl || `/api/audio-stream/${jobId}`,
                }

                // Cache completed result for fast repeat requests
                if (request.body.url) {
                  saveToCache(request.body.url, words, completeResult)
                }

                sendEvent({
                  type: 'complete',
                  result: completeResult,
                })
              }
            } catch (err) {
              console.warn('[analyze] Failed to parse line from python:', line, err)
            }
          }
        })

        childProcess.stderr.on('data', (chunk) => {
          stderrBuffer += chunk.toString()
        })

        childProcess.on('error', (err) => {
          console.error('[analyze] Python process spawn error:', err)
          reject(err)
        })

        childProcess.on('close', (code) => {
          console.log('[analyze] Python process exited with code:', code)
          if (code !== 0 && !isAborted) {
            reject(new Error(`Whisper-Transkription fehlgeschlagen (Code ${code}): ${stderrBuffer.slice(-500)}`))
          } else {
            resolve()
          }
        })
      })

      return response.end()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Analyse fehlgeschlagen.'
      const stack = error instanceof Error ? error.stack : ''
      console.error('[analyze] FEHLER:', message)
      console.error('[analyze] STACK:', stack)
      sendEvent({ type: 'error', error: message })
      setTimeout(() => {
        try { response.end() } catch {}
      }, 150)
    } finally {
      if (heartbeat) clearInterval(heartbeat)
      if (typeof temporaryDirectory === 'string') await rm(temporaryDirectory, { recursive: true, force: true })
      if (isSlotAcquired) {
        isSlotAcquired = false
        releaseAnalysisSlot()
      }
    }
  }

  // Check concurrency limit
  if (activeAnalysisCount >= MAX_CONCURRENT_ANALYSES) {
    const queuePosition = analysisQueue.length + 1
    jobState.stage = 'queue'
    jobState.queuePosition = queuePosition
    analysisQueue.push({ jobId, isAborted: false, sendEvent, start: runAnalysis })
    sendEvent({
      type: 'queue',
      queuePosition,
      queueLength: analysisQueue.length,
      message: `Server ausgelastet. Du bist in der Warteschlange (Position ${queuePosition})...`,
    })
  } else {
    activeAnalysisCount += 1
    runAnalysis()
  }
})

app.post('/api/clean-audio', upload.single('file'), async (request, response) => {
  let temporaryDirectory
  try {
    if (request.body.url && !isValidHttpUrl(request.body.url)) {
      return response.status(400).json({ error: 'Ungültige oder nicht erlaubte URL.' })
    }
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'aehmclean-'))
    let file = request.file
    if (!file && request.body.url) {
      const output = join(temporaryDirectory, 'audio.%(ext)s')
      await youtubedl(request.body.url, {
        ...commonYtDlpOptions,
        extractAudio: true,
        audioFormat: 'mp3',
        output,
      }, { timeout: 10 * 60 * 1000 })
      const downloadedFile = join(temporaryDirectory, 'audio.mp3')
      file = { buffer: await readFile(downloadedFile), originalname: 'linked-media.mp3', mimetype: 'audio/mpeg' }
    }
    if (!file) return response.status(400).json({ error: 'Bitte eine Datei oder einen Link angeben.' })

    const inputPath = join(temporaryDirectory, 'input-audio.mp3')
    await writeFile(inputPath, file.buffer)

    const rawSegments = JSON.parse(request.body.segments || '[]')
    const rawWords = JSON.parse(request.body.words || '[]').map((w) => String(w).trim().toLowerCase()).filter(Boolean)
    const duration = Number(request.body.duration || 0)

    const fillerSegments = rawSegments.filter((seg) => {
      if (!seg.counts) return false
      return Object.entries(seg.counts).some(([w, count]) => rawWords.includes(w) && Number(count) > 0)
    })

    if (!fillerSegments.length) {
      response.setHeader('Content-Type', 'audio/mpeg')
      response.setHeader('Content-Disposition', 'attachment; filename="audio-bereinigt.mp3"')
      return response.send(file.buffer)
    }

    const removeIntervals = []
    for (const seg of fillerSegments) {
      if (Array.isArray(seg.words) && seg.words.length > 0) {
        let foundWord = false
        for (const w of seg.words) {
          const wClean = String(w.clean || w.word || '').trim().toLowerCase()
          if (rawWords.some((rw) => wClean === rw || wClean.includes(rw))) {
            removeIntervals.push([Math.max(0, Number(w.start || 0) - 0.04), Number(w.end || 0) + 0.04])
            foundWord = true
          }
        }
        if (!foundWord) {
          removeIntervals.push([Math.max(0, Number(seg.start || 0) - 0.05), Number(seg.end || 0) + 0.05])
        }
      } else {
        removeIntervals.push([Math.max(0, Number(seg.start || 0) - 0.05), Number(seg.end || 0) + 0.05])
      }
    }
    removeIntervals.sort((a, b) => a[0] - b[0])

    const mergedRemove = []
    for (const interval of removeIntervals) {
      if (!mergedRemove.length) {
        mergedRemove.push(interval)
      } else {
        const last = mergedRemove[mergedRemove.length - 1]
        if (interval[0] <= last[1]) {
          last[1] = Math.max(last[1], interval[1])
        } else {
          mergedRemove.push(interval)
        }
      }
    }

    const keepIntervals = []
    let currentPos = 0
    for (const [rStart, rEnd] of mergedRemove) {
      if (rStart > currentPos + 0.1) {
        keepIntervals.push([currentPos, rStart])
      }
      currentPos = Math.max(currentPos, rEnd)
    }
    if (duration > currentPos + 0.1) {
      keepIntervals.push([currentPos, duration])
    }

    if (!keepIntervals.length) {
      response.setHeader('Content-Type', 'audio/mpeg')
      response.setHeader('Content-Disposition', 'attachment; filename="audio-bereinigt.mp3"')
      return response.send(file.buffer)
    }

    const filterParts = []
    const concatLabels = []
    keepIntervals.forEach(([start, end], idx) => {
      const label = `a${idx}`
      filterParts.push(`[0:a]atrim=start=${start.toFixed(3)}:end=${end.toFixed(3)},asetpts=PTS-STARTPTS[${label}]`)
      concatLabels.push(`[${label}]`)
    })
    filterParts.push(`${concatLabels.join('')}concat=n=${keepIntervals.length}:v=0:a=1[outa]`)
    const filterComplex = filterParts.join('; ')

    const outputPath = join(temporaryDirectory, 'cleaned.mp3')
    await runCommand('ffmpeg', ['-y', '-i', inputPath, '-filter_complex', filterComplex, '-map', '[outa]', '-b:a', '128k', outputPath], { timeout: 10 * 60 * 1000 })

    const cleanedBuffer = await readFile(outputPath)
    response.setHeader('Content-Type', 'audio/mpeg')
    response.setHeader('Content-Disposition', 'attachment; filename="audio-bereinigt.mp3"')
    return response.send(cleanedBuffer)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Audio-Bereinigung fehlgeschlagen.'
    console.error('Audio-Bereinigung fehlgeschlagen:', message)
    return response.status(500).json({ error: message })
  } finally {
    if (typeof temporaryDirectory === 'string') await rm(temporaryDirectory, { recursive: true, force: true })
  }
})

// In-memory failed deletion attempts per IP: ip -> { count: number, lockedUntil: number | null, lastAttempt: number }
const deleteAttemptsByIp = new Map()

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim()
  }
  return req.socket?.remoteAddress || req.ip || '127.0.0.1'
}

// Clean up old IP rate-limit records periodically
setInterval(() => {
  const now = Date.now()
  for (const [ip, data] of deleteAttemptsByIp.entries()) {
    if (data.lockedUntil && now > data.lockedUntil + 3600000) {
      deleteAttemptsByIp.delete(ip)
    } else if (!data.lockedUntil && now > data.lastAttempt + 3600000) {
      deleteAttemptsByIp.delete(ip)
    }
  }
}, 5 * 60 * 1000)

const handleVerifyDeletePassword = (request, response) => {
  const ip = getClientIp(request)
  const now = Date.now()
  let record = deleteAttemptsByIp.get(ip)
  if (!record) {
    record = { count: 0, lockedUntil: null, lastAttempt: now }
    deleteAttemptsByIp.set(ip, record)
  }

  // 1. Check if IP is currently locked
  if (record.lockedUntil && now < record.lockedUntil) {
    const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000)
    const remainingMinutes = Math.ceil(remainingSeconds / 60)
    return response.status(429).json({
      error: `Zu viele Fehlversuche! Ihre IP-Adresse (${ip}) ist für noch ca. ${remainingMinutes} Minute(n) gesperrt.`,
      locked: true,
      remainingSeconds,
    })
  }

  // If lockout expired, reset
  if (record.lockedUntil && now >= record.lockedUntil) {
    record.count = 0
    record.lockedUntil = null
  }

  const { password } = request.body || {}
  const rawPassword = String(password || '').trim()
  const expectedPassword = String(process.env.ADMIN_DELETE_PASSWORD || 'Secure1!').trim()

  if (!rawPassword || rawPassword !== expectedPassword) {
    record.count += 1
    record.lastAttempt = now

    if (record.count >= 3) {
      const lockMinutes = 15
      record.lockedUntil = now + lockMinutes * 60 * 1000
      return response.status(403).json({
        error: `Falsches Passwort! 3 Fehlversuche erreicht. Ihre IP-Adresse (${ip}) wurde für ${lockMinutes} Minuten gesperrt.`,
        attemptsLeft: 0,
        locked: true,
        remainingSeconds: lockMinutes * 60,
      })
    }

    const attemptsLeft = 3 - record.count
    return response.status(401).json({
      error: `Falsches Passwort! Noch ${attemptsLeft} ${attemptsLeft === 1 ? 'Versuch' : 'Versuche'} vor IP-Sperre.`,
      attemptsLeft,
      locked: false,
    })
  }

  // Success: reset attempts for this IP
  deleteAttemptsByIp.delete(ip)
  return response.json({
    success: true,
    message: 'Passwort erfolgreich verifiziert.',
  })
}

app.post('/api/admin/verify-delete-password', handleVerifyDeletePassword)
app.post('/api/verify-delete-password', handleVerifyDeletePassword)
app.post('/verify-delete-password', handleVerifyDeletePassword)

const distDirectory = join(projectRoot, 'dist')
if (existsSync(distDirectory)) {
  // Static assets with cache headers
  app.use('/assets', express.static(join(distDirectory, 'assets'), {
    maxAge: '1y',
    immutable: true,
  }))
  app.use(express.static(distDirectory, {
    maxAge: '1h',
  }))

  // SPA fallback - NEVER return index.html for missing assets or api
  app.use((request, response, next) => {
    if (request.path.startsWith('/api')) return next()
    if (request.path.startsWith('/assets/') || /\.(js|css|map|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/i.test(request.path)) {
      return response.status(404).type('text/plain').send('Asset not found')
    }
    // Prevent caching index.html so clients always get latest asset hashes
    response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    response.setHeader('Pragma', 'no-cache')
    response.setHeader('Expires', '0')
    response.sendFile(join(distDirectory, 'index.html'))
  })
}

app.listen(port, () => console.log(`Ähm-Zähler läuft auf http://0.0.0.0:${port}`))