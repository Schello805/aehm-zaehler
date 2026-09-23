import express from 'express'
import multer from 'multer'
import { create as createYoutubeDl } from 'youtube-dl-exec'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
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
  let childProcess = null
  let isAborted = false
  let heartbeat = null

  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  response.write(': connected\n\n')
  if (typeof response.flush === 'function') response.flush()

  heartbeat = setInterval(() => {
    if (!response.writableEnded && !isAborted) {
      response.write(': ping\n\n')
      if (typeof response.flush === 'function') response.flush()
    }
  }, 3000)

  const sendEvent = (data) => {
    if (response.writableEnded || isAborted) return
    response.write(`data: ${JSON.stringify(data)}\n\n`)
    if (typeof response.flush === 'function') response.flush()
  }

  request.on('close', () => {
    isAborted = true
    if (heartbeat) clearInterval(heartbeat)
    if (childProcess) {
      try {
        childProcess.kill('SIGKILL')
      } catch {}
    }
  })

  try {
    console.log('[analyze] Request received at', new Date().toISOString())
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'aehmzaehler-'))
    console.log('[analyze] Temp dir:', temporaryDirectory)

    const words = JSON.parse(request.body.words || '[]').map((word) => word.trim().toLowerCase()).filter(Boolean)
    console.log('[analyze] Words to search:', words)

    let file = request.file
    if (!file && request.body.url) {
      console.log('[analyze] Downloading from URL:', request.body.url)
      sendEvent({ type: 'status', stage: 'download', message: 'Lade Video / Audio von YouTube herunter...' })

      const output = join(temporaryDirectory, 'audio.%(ext)s')
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
        throw new Error(`YouTube-Download fehlgeschlagen: ${msg.split('\n')[0]}`)
      }

      const dirFiles = await readdir(temporaryDirectory)
      const downloadedFileName = dirFiles.find((f) => f.startsWith('audio.'))
      if (!downloadedFileName) {
        throw new Error('Die heruntergeladene Audiodatei konnte im temporären Verzeichnis nicht gefunden werden.')
      }
      const downloadedFilePath = join(temporaryDirectory, downloadedFileName)
      file = { buffer: await readFile(downloadedFilePath), originalname: 'linked-media.mp3', mimetype: 'audio/mpeg' }
      console.log('[analyze] Download complete, file:', downloadedFileName, 'size:', file.buffer.length)
    }

    if (!file) {
      sendEvent({ type: 'error', error: 'Bitte eine Datei oder einen Link angeben.' })
      return response.end()
    }
    console.log('[analyze] File:', file.originalname, 'size:', file.buffer.length, 'mime:', file.mimetype)

    if (file.buffer.length > 24 * 1024 * 1024 || file.mimetype === 'video/mp4') {
      console.log('[analyze] Compressing with ffmpeg...')
      sendEvent({ type: 'status', stage: 'converting', message: 'Optimiere Audio für Whisper KI...' })
      const inputPath = join(temporaryDirectory, 'input-media')
      const compressedPath = join(temporaryDirectory, 'compressed.mp3')
      await writeFile(inputPath, file.buffer)
      await runCommand('ffmpeg', ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', compressedPath], { timeout: 10 * 60 * 1000 })
      file = { buffer: await readFile(compressedPath), originalname: 'compressed-audio.mp3', mimetype: 'audio/mpeg' }
      console.log('[analyze] Compressed size:', file.buffer.length)
    }

    const workingAudioPath = join(temporaryDirectory, 'prepared-audio.mp3')
    await writeFile(workingAudioPath, file.buffer)

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
              const finalSegments = Array.isArray(data.segments) && data.segments.length > 0
                ? data.segments.map((s) => ({
                    start: Number(s.start || 0),
                    end: Number(s.end || 0),
                    text: String(s.text || ''),
                    counts: countSegmentWords(String(s.text || ''), words),
                  }))
                : segments

              sendEvent({
                type: 'complete',
                result: {
                  text,
                  duration: finalDuration,
                  counts,
                  fillerWords,
                  baseFillerWords,
                  totalWords,
                  relativeRate,
                  segments: finalSegments,
                },
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
        reject(err)
      })

      childProcess.on('close', (code) => {
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
    return response.end()
  } finally {
    if (heartbeat) clearInterval(heartbeat)
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