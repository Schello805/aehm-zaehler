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

const getUrlMetadata = async (url) => {
  if (!isValidHttpUrl(url)) {
    throw new Error('Ungültige oder nicht erlaubte URL.')
  }
  const metadata = await youtubedl(url, {
    ...commonYtDlpOptions,
    dumpSingleJson: true,
    noDownload: true,
  }, { timeout: 2 * 60 * 1000 })
  return {
    duration: Number(metadata.duration || 0),
    title: String(metadata.title || '').trim(),
    uploader: String(metadata.uploader || metadata.channel || '').trim(),
    thumbnail: String(metadata.thumbnail || '').trim(),
  }
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
    isAborted = true
    if (heartbeat) clearInterval(heartbeat)
    const queueIdx = analysisQueue.findIndex((q) => q.jobId === jobId)
    if (queueIdx !== -1) {
      const [removed] = analysisQueue.splice(queueIdx, 1)
      if (removed) removed.isAborted = true
      notifyQueuePositions()
    }
    if (childProcess) {
      try {
        childProcess.kill('SIGKILL')
      } catch {}
    }
    if (isSlotAcquired) {
      isSlotAcquired = false
      releaseAnalysisSlot()
    }
  })

  const runAnalysis = async () => {
    isSlotAcquired = true
    try {
      console.log('[analyze] Starting job execution for:', jobId)
      if (request.body.url && !isValidHttpUrl(request.body.url)) {
        throw new Error('Ungültige oder nicht erlaubte Medien-URL.')
      }

      temporaryDirectory = await mkdtemp(join(tmpdir(), 'aehmzaehler-'))
      console.log('[analyze] Temp dir:', temporaryDirectory)

      const words = JSON.parse(request.body.words || '[]').map((word) => word.trim().toLowerCase()).filter(Boolean)
      console.log('[analyze] Words to search:', words)

      let file = request.file
      let mediaTitle = request.body.title ? String(request.body.title).trim() : ''
      if (file && !mediaTitle) {
        mediaTitle = file.originalname
      }

      if (!file && request.body.url) {
        console.log('[analyze] Downloading from URL:', request.body.url)
        sendEvent({ type: 'status', stage: 'download', message: 'Lade Video / Audio von YouTube herunter...' })

        // Fetch YouTube video title & metadata
        try {
          const info = await getUrlMetadata(request.body.url)
          if (info?.title && !mediaTitle) {
            mediaTitle = info.title
            jobState.mediaTitle = mediaTitle
            sendEvent({ type: 'status', stage: 'download', message: `Lade „${mediaTitle}“ herunter...`, mediaTitle })
          }
        } catch (tErr) {
          console.log('[analyze] Title fetch note:', tErr?.message)
        }

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
                const finalSegments = Array.isArray(data.segments) && data.segments.length > 0
                  ? data.segments.map((s) => ({
                      start: Number(s.start || 0),
                      end: Number(s.end || 0),
                      text: String(s.text || ''),
                      counts: countSegmentWords(String(s.text || ''), words),
                    }))
                  : segments

                console.log('[analyze] Complete! Total words:', totalWords, 'Fillers:', fillerWords, 'Segments:', finalSegments.length)
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
                    mediaTitle: mediaTitle || (file ? file.originalname : ''),
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