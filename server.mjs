import express from 'express'
import multer from 'multer'
import { create as createYoutubeDl } from 'youtube-dl-exec'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { existsSync } from 'node:fs'

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
const projectRoot = process.cwd()
const localPythonPath = join(projectRoot, '.venv', 'bin', 'python')
const localTranscriptionScript = join(projectRoot, 'transcribe_local.py')

const commonYtDlpOptions = {
  noPlaylist: true,
  quiet: true,
  extractorArgs: 'youtube:player_client=android,web',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

const getUrlDuration = async (url) => {
  const metadata = await youtubedl(url, {
    ...commonYtDlpOptions,
    dumpSingleJson: true,
    noDownload: true,
  }, { timeout: 2 * 60 * 1000 })
  return Number(metadata.duration || 0)
}

const countWordOccurrences = (text, word) => {
  const tokens = text.toLocaleLowerCase('de-DE').match(/[\p{L}\p{N}]+/gu) || []
  const searchTokens = word.toLocaleLowerCase('de-DE').match(/[\p{L}\p{N}]+/gu) || []
  if (!searchTokens.length) return 0

  let matches = 0
  for (let index = 0; index <= tokens.length - searchTokens.length; index += 1) {
    if (searchTokens.every((token, offset) => tokens[index + offset] === token)) matches += 1
  }
  return matches
}

const countSegmentWords = (text, words) => Object.fromEntries(words.map((word) => [word, countWordOccurrences(text, word)]))

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

app.post('/api/media-info', async (request, response) => {
  try {
    const url = String(request.body.url || '').trim()
    if (!url) return response.status(400).json({ error: 'Kein Medienlink angegeben.' })

    const duration = await getUrlDuration(url)
    if (!duration) return response.status(422).json({ error: 'Die Länge des Mediums konnte nicht aus den Metadaten gelesen werden.' })

    return response.json({ duration })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Medienmetadaten konnten nicht geladen werden.'
    console.error('Metadaten konnten nicht geladen werden:', message)
    return response.status(400).json({ error: 'Die Medienlänge konnte für diesen Link nicht ermittelt werden.' })
  }
})

app.post('/api/analyze', upload.single('file'), async (request, response) => {
  let temporaryDirectory
  const analysisController = new AbortController()
  request.on('aborted', () => analysisController.abort())
  try {
    console.log('[analyze] Request received')
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'aehmzaehler-'))
    console.log('[analyze] Temp dir:', temporaryDirectory)

    const words = JSON.parse(request.body.words || '[]').map((word) => word.trim().toLowerCase()).filter(Boolean)
    console.log('[analyze] Words to search:', words)

    let file = request.file
    if (!file && request.body.url) {
      console.log('[analyze] Downloading from URL:', request.body.url)
      const output = join(temporaryDirectory, 'audio.%(ext)s')
      await youtubedl(request.body.url, {
        ...commonYtDlpOptions,
        extractAudio: true,
        audioFormat: 'mp3',
        output,
      }, { timeout: 10 * 60 * 1000 })
      const downloadedFile = join(temporaryDirectory, 'audio.mp3')
      file = { buffer: await readFile(downloadedFile), originalname: 'linked-media.mp3', mimetype: 'audio/mpeg' }
      console.log('[analyze] Download complete, size:', file.buffer.length)
    }
    if (!file) return response.status(400).json({ error: 'Bitte eine Datei oder einen Link angeben.' })
    console.log('[analyze] File:', file.originalname, 'size:', file.buffer.length, 'mime:', file.mimetype)

    if (file.buffer.length > 24 * 1024 * 1024 || file.mimetype === 'video/mp4') {
      console.log('[analyze] Compressing with ffmpeg...')
      const inputPath = join(temporaryDirectory, 'input-media')
      const compressedPath = join(temporaryDirectory, 'compressed.mp3')
      await writeFile(inputPath, file.buffer)
      await runCommand('ffmpeg', ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', compressedPath], { timeout: 10 * 60 * 1000, signal: analysisController.signal })
      file = { buffer: await readFile(compressedPath), originalname: 'compressed-audio.mp3', mimetype: 'audio/mpeg' }
      console.log('[analyze] Compressed size:', file.buffer.length)
    }
    if (file.buffer.length > 25 * 1024 * 1024) return response.status(413).json({ error: 'Die Audiodatei ist auch nach der Komprimierung größer als 25 MB. Bitte eine kürzere Aufnahme verwenden.' })

    const workingAudioPath = join(temporaryDirectory, 'prepared-audio.mp3')
    await writeFile(workingAudioPath, file.buffer)

    console.log('[analyze] Running whisper via python:', localPythonPath)
    console.log('[analyze] Script:', localTranscriptionScript)
    console.log('[analyze] Python exists:', existsSync(localPythonPath))
    console.log('[analyze] Script exists:', existsSync(localTranscriptionScript))

    const localResult = await runCommand(localPythonPath, [localTranscriptionScript, workingAudioPath, words.join(',')], {
      timeout: 20 * 60 * 1000,
      maxBuffer: 50 * 1024 * 1024,
      signal: analysisController.signal,
    })
    console.log('[analyze] Python stdout (first 500 chars):', localResult.stdout?.slice(0, 500))
    console.log('[analyze] Python stderr (first 500 chars):', localResult.stderr?.slice(0, 500))

    const transcription = JSON.parse(localResult.stdout)
    console.log('[analyze] Parsed transcription, text length:', transcription.text?.length, 'duration:', transcription.duration)

    const text = transcription.text || ''
    const counts = Object.fromEntries(words.map((word) => [word, countWordOccurrences(text, word)]))
    const fillerWords = Object.values(counts).reduce((sum, count) => sum + count, 0)
    const phraseOverlap = getPhraseOverlap(words, counts)
    const baseFillerWords = Math.max(0, fillerWords - phraseOverlap)
    const totalWords = text.trim() ? text.trim().split(/\s+/).length : 0
    const segments = Array.isArray(transcription.segments)
      ? transcription.segments.map((segment) => ({
        start: Number(segment.start || 0),
        end: Number(segment.end || 0),
        text: String(segment.text || ''),
        counts: countSegmentWords(String(segment.text || ''), words),
      }))
      : []
    console.log('[analyze] Success – fillerWords:', fillerWords, 'totalWords:', totalWords)
    return response.json({ text, duration: Number(transcription.duration || 0), counts, fillerWords, baseFillerWords, totalWords, relativeRate: totalWords ? baseFillerWords / totalWords : 0, segments })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analyse fehlgeschlagen.'
    const stack = error instanceof Error ? error.stack : ''
    console.error('[analyze] FEHLER:', message)
    console.error('[analyze] STACK:', stack)
    return response.status(message.includes('format') ? 400 : 500).json({ error: message })
  } finally {
    if (typeof temporaryDirectory === 'string') await rm(temporaryDirectory, { recursive: true, force: true })
  }
})

app.post('/api/clean-audio', upload.single('file'), async (request, response) => {
  let temporaryDirectory
  try {
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

    const removeIntervals = fillerSegments
      .map((s) => [Math.max(0, Number(s.start || 0) - 0.05), Number(s.end || 0) + 0.05])
      .sort((a, b) => a[0] - b[0])

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

const distDirectory = join(projectRoot, 'dist')
if (existsSync(distDirectory)) {
  app.use(express.static(distDirectory))
  app.use((request, response, next) => {
    if (request.path.startsWith('/api')) return next()
    response.sendFile(join(distDirectory, 'index.html'))
  })
}

app.listen(port, () => console.log(`Ähm-Zähler läuft auf http://0.0.0.0:${port}`))