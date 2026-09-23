import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { defaultEstimatedAnalysisSeconds, getEstimatedAnalysisSeconds } from './progress'

declare global {
  interface Window {
    YT?: any
    onYouTubeIframeAPIReady?: () => void
  }
}

const defaults = ['äh', 'ähm']

const countWordOccurrences = (text: string, word: string) => {
  const tokens = text.toLocaleLowerCase('de-DE').match(/[\p{L}\p{N}]+/gu) || []
  const searchTokens = word.toLocaleLowerCase('de-DE').match(/[\p{L}\p{N}]+/gu) || []
  if (!searchTokens.length) return 0

  let matches = 0
  for (let index = 0; index <= tokens.length - searchTokens.length; index += 1) {
    if (searchTokens.every((token, offset) => tokens[index + offset] === token)) matches += 1
  }
  return matches
}

type Result = {
  counts: Record<string, number>
  fillerWords: number
  baseFillerWords: number
  totalWords: number
  relativeRate: number
  duration: number
  text: string
  segments: TranscriptSegment[]
  mediaTitle?: string
}

type TranscriptSegment = {
  start: number
  end: number
  text: string
  counts: Record<string, number>
}

type ProgressState = {
  percent: number
  step: number
  label: string
  remainingSeconds: number | null
}

type HistoryEntry = {
  id: string
  source: string
  sourceLabel: string
  createdAt: string
  result: Result
  words: string[]
  title: string
  note: string
  tags: string[]
}

const progressSteps = ['Vorbereitung', 'Medien prüfen', 'Audio verarbeiten', 'Transkription läuft', 'Ergebnis auswerten']

const formatRemainingTime = (remainingSeconds: number) => {
  if (remainingSeconds <= 0) return 'bald fertig'
  const totalSeconds = Math.max(0, Math.ceil(remainingSeconds))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')} min`
}

const formatTimestamp = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`


const getOptimizationAdvice = (result: Result) => {
  const effectiveFillerWords = result.baseFillerWords ?? result.fillerWords
  const perMinute = result.duration > 0 ? (effectiveFillerWords / result.duration) * 60 : 0

  if (effectiveFillerWords === 0) {
    return {
      tone: 'good',
      title: 'Sehr klarer Sprechfluss',
      summary: 'Keine der gesuchten Füllwörter erkannt. Bewusste Pausen kannst du trotzdem als Stilmittel nutzen.',
      tips: ['Satz zu Ende führen', 'Stimme am Satzende absenken', 'Pausen bewusst stehen lassen'],
      rate: perMinute,
    }
  }

  if (perMinute <= 2) {
    return {
      tone: 'good',
      title: 'Unauffälliger Bereich',
      summary: 'Einzelne Füllwörter wirken meist nicht störend. Achte darauf, ob sie immer an denselben Denkstellen auftauchen.',
      tips: ['Muster wahrnehmen', 'Kurze Pause statt „ähm“', 'Gedanken nicht vorwegnehmen'],
      rate: perMinute,
    }
  }

  if (perMinute <= 5) {
    return {
      tone: 'watch',
      title: 'Beobachtungsbereich',
      summary: 'Das kann noch natürlich wirken. Wenn der Inhalt dadurch unruhig wird, lohnt sich gezieltes Pausentraining.',
      tips: ['Nach jedem Gedanken pausieren', 'Stimme vor der Pause absenken', 'Aufnahme nach auffälligen Stellen abhören'],
      rate: perMinute,
    }
  }

  return {
    tone: 'focus',
    title: 'Klares Übungsfeld',
    summary: 'Die Häufigkeit kann vom Inhalt ablenken. Ersetze gefüllte Pausen Schritt für Schritt durch Stille.',
    tips: ['Sätze kürzer planen', 'Bewusst zwei Sekunden schweigen', '30 Tage regelmäßig üben'],
    rate: perMinute,
  }
}

function App() {
  const [view, setView] = useState<'analyse' | 'live' | 'settings'>('analyse')
  const [darkMode, setDarkMode] = useState<boolean>(() => localStorage.getItem('dark-mode') === 'true')
  const [words, setWords] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('fill-words') || 'null')
      return Array.isArray(stored) ? stored : defaults
    } catch {
      return defaults
    }
  })
  const [newWord, setNewWord] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [analysisTitle, setAnalysisTitle] = useState('')
  const [analysisNote, setAnalysisNote] = useState('')
  const [analysisTags, setAnalysisTags] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<ProgressState>({ percent: 5, step: 0, label: 'Vorbereitung', remainingSeconds: defaultEstimatedAnalysisSeconds })
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('analysis-history') || '[]')
      return Array.isArray(stored) ? stored : []
    } catch {
      return []
    }
  })
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null)
  const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null)
  const [historyEditValue, setHistoryEditValue] = useState('')
  const [historyFilter, setHistoryFilter] = useState('')
  const [historySort, setHistorySort] = useState<'newest' | 'oldest' | 'words' | 'rate'>('newest')
  const [isCleaningAudio, setIsCleaningAudio] = useState(false)
  const [cleanAudioError, setCleanAudioError] = useState('')
  const [isSupercutActive, setIsSupercutActive] = useState(false)
  const [ytPlayer, setYtPlayer] = useState<any>(null)
  const [activePlayTime, setActivePlayTime] = useState(0)
  const [supercutCurrentIndex, setSupercutCurrentIndex] = useState(0)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const playbackRef = useRef<HTMLAudioElement>(null)
  const analysisControllerRef = useRef<AbortController | null>(null)
  const currentJobIdRef = useRef<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle')
  const playbackUrl = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file])

  const activeSourceUrl = useMemo(() => {
    if (activeHistoryId) {
      const entry = history.find((h) => h.id === activeHistoryId)
      return entry?.source || url || ''
    }
    return url || ''
  }, [activeHistoryId, history, url])

  const getYouTubeVideoId = (srcUrl: string): string | null => {
    if (!srcUrl) return null
    const match = srcUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/)
    return match ? match[1] : null
  }

  const activeYoutubeId = useMemo(() => getYouTubeVideoId(activeSourceUrl), [activeSourceUrl])

  useEffect(() => {
    if (typeof window !== 'undefined' && !window.YT) {
      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      document.body.appendChild(tag)
    }
  }, [])

  useEffect(() => {
    if (!activeYoutubeId) {
      setYtPlayer(null)
      return
    }

    let isMounted = true
    let playerInstance: any = null

    const connectPlayer = () => {
      if (!isMounted) return
      if (window.YT && window.YT.Player) {
        try {
          const el = document.getElementById('youtube-sync-iframe')
          if (el) {
            playerInstance = new window.YT.Player('youtube-sync-iframe', {
              events: {
                onReady: (event: any) => {
                  if (isMounted) setYtPlayer(event.target)
                },
              },
            })
          }
        } catch (err) {
          console.warn('YouTube Player Connect:', err)
        }
      }
    }

    const timer = setTimeout(connectPlayer, 150)
    if (window.YT && window.YT.Player) {
      connectPlayer()
    } else {
      window.onYouTubeIframeAPIReady = connectPlayer
    }

    return () => {
      isMounted = false
      clearTimeout(timer)
      if (playerInstance && typeof playerInstance.destroy === 'function') {
        try { playerInstance.destroy() } catch {}
      }
    }
  }, [activeYoutubeId])

  const fillerSegments = useMemo(() => {
    if (!result?.segments) return []
    return result.segments.filter((seg) => {
      if (!seg.counts) return false
      return Object.entries(seg.counts).some(([w, count]) => words.includes(w) && count > 0)
    })
  }, [result, words])

  const seekAndPlay = (seconds: number) => {
    const target = Math.max(0, seconds)
    setActivePlayTime(target)
    if (ytPlayer && typeof ytPlayer.seekTo === 'function') {
      try {
        ytPlayer.seekTo(target, true)
        if (typeof ytPlayer.playVideo === 'function') ytPlayer.playVideo()
      } catch {}
    } else {
      const iframe = document.getElementById('youtube-sync-iframe') as HTMLIFrameElement | null
      if (iframe && iframe.contentWindow) {
        try {
          iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [target, true] }), '*')
          iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*')
        } catch {}
      }
    }

    if (playbackRef.current) {
      playbackRef.current.currentTime = target
      void playbackRef.current.play()
    }
  }

  const jumpToFiller = (direction: 'next' | 'prev') => {
    if (!fillerSegments.length) return
    let currentTime = activePlayTime
    if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
      try { currentTime = ytPlayer.getCurrentTime() || activePlayTime } catch {}
    } else if (playbackRef.current) {
      currentTime = playbackRef.current.currentTime || activePlayTime
    }

    if (direction === 'next') {
      const nextIndex = fillerSegments.findIndex((seg) => seg.start > currentTime + 0.3)
      const idx = nextIndex !== -1 ? nextIndex : 0
      setSupercutCurrentIndex(idx)
      seekAndPlay(Math.max(0, fillerSegments[idx].start - 0.1))
    } else {
      const prevSegs = fillerSegments.filter((seg) => seg.start < currentTime - 0.5)
      const idx = prevSegs.length ? fillerSegments.indexOf(prevSegs[prevSegs.length - 1]) : fillerSegments.length - 1
      setSupercutCurrentIndex(idx)
      seekAndPlay(Math.max(0, fillerSegments[idx].start - 0.1))
    }
  }

  useEffect(() => {
    if (!isSupercutActive || !fillerSegments.length) return

    let lastIndex = 0
    setSupercutCurrentIndex(0)
    seekAndPlay(Math.max(0, fillerSegments[0].start - 0.1))

    const interval = window.setInterval(() => {
      let currentTime = 0
      let isPaused = true

      if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
        try {
          currentTime = ytPlayer.getCurrentTime() || 0
          const state = typeof ytPlayer.getPlayerState === 'function' ? ytPlayer.getPlayerState() : -1
          isPaused = state !== 1 // 1 is PLAYING
        } catch {}
      } else if (playbackRef.current) {
        currentTime = playbackRef.current.currentTime || 0
        isPaused = playbackRef.current.paused
      }

      if (isPaused) return
      setActivePlayTime(currentTime)

      const currentSeg = fillerSegments[lastIndex]
      if (currentSeg && currentTime >= currentSeg.end + 0.35) {
        const nextIndex = (lastIndex + 1) % fillerSegments.length
        lastIndex = nextIndex
        setSupercutCurrentIndex(nextIndex)
        const nextSeg = fillerSegments[nextIndex]
        seekAndPlay(Math.max(0, nextSeg.start - 0.1))
      }
    }, 120)

    return () => window.clearInterval(interval)
  }, [isSupercutActive, fillerSegments, ytPlayer])

  const downloadCleanAudio = async () => {
    if (!result) return
    setIsCleaningAudio(true)
    setCleanAudioError('')
    try {
      const body = new FormData()
      body.append('words', JSON.stringify(words))
      body.append('segments', JSON.stringify(result.segments || []))
      body.append('duration', String(result.duration || 0))
      if (file) body.append('file', file)
      if (url) body.append('url', url)

      const response = await fetch('/api/clean-audio', {
        method: 'POST',
        body,
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Audio-Bereinigung fehlgeschlagen.')
      }

      const blob = await response.blob()
      const downloadUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = downloadUrl
      anchor.download = 'audio-bereinigt.mp3'
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(downloadUrl)
    } catch (err) {
      setCleanAudioError(err instanceof Error ? err.message : 'Audio-Bereinigung fehlgeschlagen.')
    } finally {
      setIsCleaningAudio(false)
    }
  }

  const printPdfReport = () => {
    window.print()
  }

  const copyTextSummary = () => {
    if (!result) return
    const advice = getOptimizationAdvice(result)
    const topWords = Object.entries(result.counts || {})
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([w, c]) => `• „${w}“: ${c}×`)
      .join('\n')

    const summaryText = `📊 Sprechfluss-Analyse: ${activeSourceLabel || 'Audio/Video'}
⏱️ Dauer: ${formatTimestamp(result.duration)} Min.
🗣️ Wörter gesamt: ${result.totalWords.toLocaleString('de-DE')}
🚨 Füllwörter gesamt: ${result.fillerWords} (${((result.relativeRate || 0) * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} % — ${advice.rate.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Füllwörter/Min.)

🔍 Häufigste Füllwörter:
${topWords || '• Keine Füllwörter gefunden'}

💡 Feedback: ${advice.title}
${advice.summary}

🔗 Erstellt mit https://aehm-zaehler.de`

    navigator.clipboard.writeText(summaryText).then(() => {
      setCopyStatus('copied')
      setTimeout(() => setCopyStatus('idle'), 2500)
    }).catch(() => {})
  }

  const downloadReportCardImage = () => {
    if (!result) return
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 800
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const advice = getOptimizationAdvice(result)

    // Background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, 800)
    bgGrad.addColorStop(0, '#fbf9f5')
    bgGrad.addColorStop(1, '#eee7dd')
    ctx.fillStyle = bgGrad
    ctx.fillRect(0, 0, 1200, 800)

    // Decorative top border
    ctx.fillStyle = '#c75b47'
    ctx.fillRect(0, 0, 1200, 6)

    // Header bar
    ctx.fillStyle = '#1d1c1a'
    ctx.font = 'bold 36px "Outfit", sans-serif'
    ctx.fillText('ähzähler', 60, 70)

    ctx.fillStyle = '#c75b47'
    ctx.font = 'bold 15px sans-serif'
    ctx.fillText('SPRECHFLUSS-ANALYSEBERICHT', 60, 102)

    // Date
    ctx.fillStyle = '#6d665f'
    ctx.font = '15px sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }), 1140, 70)
    ctx.fillText('aehm-zaehler.de', 1140, 95)
    ctx.textAlign = 'left'

    // Separator line
    ctx.strokeStyle = '#d8d1c8'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(60, 120)
    ctx.lineTo(1140, 120)
    ctx.stroke()

    // Title & source
    ctx.fillStyle = '#1d1c1a'
    ctx.font = 'bold 22px "Outfit", sans-serif'
    const titleText = (activeSourceLabel || 'Aufnahme').slice(0, 75)
    ctx.fillText(titleText, 60, 160)

    ctx.fillStyle = '#6d665f'
    ctx.font = '15px sans-serif'
    ctx.fillText(`Gesamtdauer: ${formatTimestamp(result.duration)} Min. • ${result.totalWords.toLocaleString('de-DE')} gesprochene Wörter`, 60, 190)

    // 3 Stat Cards
    const drawCard = (x: number, y: number, w: number, h: number, title: string, value: string, sub: string, highlight?: boolean) => {
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, 14)
      ctx.fill()
      ctx.strokeStyle = highlight ? '#c75b47' : '#d8d1c8'
      ctx.lineWidth = highlight ? 2 : 1
      ctx.stroke()

      ctx.fillStyle = '#6d665f'
      ctx.font = 'bold 13px sans-serif'
      ctx.fillText(title.toUpperCase(), x + 24, y + 36)

      ctx.fillStyle = highlight ? '#c75b47' : '#1d1c1a'
      ctx.font = 'bold 42px "Outfit", sans-serif'
      ctx.fillText(value, x + 24, y + 90)

      ctx.fillStyle = '#8a8279'
      ctx.font = '14px sans-serif'
      ctx.fillText(sub, x + 24, y + 124)
    }

    drawCard(60, 220, 340, 150, 'Gesprochene Wörter', result.totalWords.toLocaleString('de-DE'), 'Wortanzahl total')
    drawCard(430, 220, 340, 150, 'Füllwörter gesamt', String(result.fillerWords), `${((result.relativeRate || 0) * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} % Füllwort-Quote`, true)
    drawCard(800, 220, 340, 150, 'Füllwort-Tempo', `${advice.rate.toLocaleString('de-DE', { maximumFractionDigits: 1 })} /min`, 'Füllwörter pro Minute')

    // Feedback Box
    ctx.fillStyle = advice.tone === 'good' ? 'rgba(47, 122, 92, 0.08)' : 'rgba(199, 91, 71, 0.08)'
    ctx.beginPath()
    ctx.roundRect(60, 400, 1080, 150, 14)
    ctx.fill()
    ctx.strokeStyle = advice.tone === 'good' ? 'rgba(47, 122, 92, 0.3)' : 'rgba(199, 91, 71, 0.3)'
    ctx.lineWidth = 1.5
    ctx.stroke()

    ctx.fillStyle = advice.tone === 'good' ? '#2f7a5c' : '#c75b47'
    ctx.font = 'bold 20px "Outfit", sans-serif'
    ctx.fillText(`Fazit & Analyse: ${advice.title}`, 90, 442)

    ctx.fillStyle = '#1d1c1a'
    ctx.font = '16px sans-serif'
    ctx.fillText(advice.summary, 90, 478)

    ctx.fillStyle = '#6d665f'
    ctx.font = 'italic 14px sans-serif'
    ctx.fillText(`Tipps für die Praxis: ${advice.tips.join(' • ')}`, 90, 516)

    // Top words section
    ctx.fillStyle = '#1d1c1a'
    ctx.font = 'bold 18px "Outfit", sans-serif'
    ctx.fillText('Häufigste Füllwörter im Detail:', 60, 595)

    const topWords = Object.entries(result.counts || {})
      .filter(([, c]) => c > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)

    let wx = 60
    if (topWords.length === 0) {
      ctx.fillStyle = '#2f7a5c'
      ctx.font = '16px sans-serif'
      ctx.fillText('Keine Füllwörter erkannt — Exzellenter Sprechfluss!', 60, 640)
    } else {
      for (const [w, c] of topWords) {
        const text = `„${w}“: ${c}×`
        ctx.font = 'bold 16px sans-serif'
        const tw = ctx.measureText(text).width + 36
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.roundRect(wx, 615, tw, 42, 8)
        ctx.fill()
        ctx.strokeStyle = '#d8d1c8'
        ctx.lineWidth = 1
        ctx.stroke()

        ctx.fillStyle = '#c75b47'
        ctx.fillText(text, wx + 18, 642)
        wx += tw + 14
      }
    }

    // Footer
    ctx.fillStyle = '#8a8279'
    ctx.font = '14px sans-serif'
    ctx.fillText('Erstellt mit ähzähler (https://aehm-zaehler.de) — Sprechfluss sichtbar machen & trainieren', 60, 755)

    const dataUrl = canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `sprechfluss-bericht-${Date.now()}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  useEffect(() => () => {
    if (playbackUrl) URL.revokeObjectURL(playbackUrl)
  }, [playbackUrl])

  useEffect(() => {
    localStorage.setItem('fill-words', JSON.stringify(words))
  }, [words])

  useEffect(() => {
    localStorage.setItem('analysis-history', JSON.stringify(history))
  }, [history])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
    localStorage.setItem('dark-mode', String(darkMode))
  }, [darkMode])

  useEffect(() => {
    if (!file && !url) {
      return
    }

    const source = file ? URL.createObjectURL(file) : url
    const media = new Audio(source)

    const onLoadedMetadata = () => {
      const duration = Number.isFinite(media.duration) ? media.duration : null
      const estimate = getEstimatedAnalysisSeconds(duration ?? undefined)
      setProgress((current) => ({ ...current, remainingSeconds: estimate }))
    }

    media.preload = 'metadata'
    media.addEventListener('loadedmetadata', onLoadedMetadata)
    media.addEventListener('error', () => {
      setProgress((current) => ({ ...current, remainingSeconds: defaultEstimatedAnalysisSeconds }))
    })

    media.load()

    return () => {
      media.removeEventListener('loadedmetadata', onLoadedMetadata)
      if (file) URL.revokeObjectURL(source)
    }
  }, [file, url])

  const activeHistoryEntry = useMemo(
    () => (activeHistoryId ? history.find((entry) => entry.id === activeHistoryId) : null),
    [history, activeHistoryId]
  )
  const currentMediaTitle = useMemo(() => {
    if (activeHistoryEntry?.title) return activeHistoryEntry.title
    if (activeHistoryEntry?.sourceLabel) return activeHistoryEntry.sourceLabel
    if (analysisTitle) return analysisTitle
    if (result?.mediaTitle) return result.mediaTitle
    if (file?.name) return file.name
    if (url) {
      const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/)
      if (match) return `YouTube (${match[1]})`
      return url
    }
    return ''
  }, [activeHistoryEntry, analysisTitle, result, file, url])

  const activeSourceLabel = currentMediaTitle || 'Unbekannte Quelle'

  // Dynamic Browser Tab Title to clearly distinguish multiple instances/tabs
  useEffect(() => {
    if (isAnalyzing) {
      document.title = currentMediaTitle
        ? `(${Math.round(progress.percent)}%) ${currentMediaTitle} — ähzähler`
        : `(${Math.round(progress.percent)}%) Analyse läuft — ähzähler`
    } else if (result && currentMediaTitle) {
      document.title = `✓ ${currentMediaTitle} — ähzähler`
    } else {
      document.title = 'ähzähler — Füllwörter sichtbar machen'
    }
  }, [isAnalyzing, progress.percent, result, currentMediaTitle])

  const detectedCrutchWords = useMemo(() => {
    if (!result?.text) return []
    // Curated list of genuine German verbal crutches & rhetorical filler phrases (Floskeln)
    const genuineCrutches = [
      'quasi',
      'sozusagen',
      'im endeffekt',
      'eigentlich',
      'halt',
      'irgendwie',
      'sprich',
      'sag ich mal',
      'wie gesagt',
      'im prinzip',
      'auf jeden fall',
      'letzten endes',
      'praktisch',
      'schlussendlich',
      'gewissermaßen',
      'tatsächlich',
      'wortwörtlich',
      'am ende des tages',
      'im grunde',
      'genau genommen',
      'schlichtweg',
      'so nach dem motto',
      'ich sag mal',
      'so ungefähr',
      'ehrlich gesagt',
      'mehr oder weniger',
      'im wesentlichen',
      'überhaupt'
    ]

    const currentWordsLower = new Set(words.map((w) => w.trim().toLowerCase()))
    const foundList: { word: string; count: number; isUnlisted: boolean }[] = []

    for (const crutch of genuineCrutches) {
      const count = countWordOccurrences(result.text, crutch)
      if (count >= 1 && !currentWordsLower.has(crutch)) {
        foundList.push({ word: crutch, count, isUnlisted: true })
      }
    }

    return foundList.sort((a, b) => b.count - a.count).slice(0, 10)
  }, [result?.text, words])

  const filteredHistory = useMemo(() => {
    const query = historyFilter.trim().toLowerCase()
    const items = query
      ? history.filter((entry) => entry.source.toLowerCase().includes(query) || entry.sourceLabel.toLowerCase().includes(query))
      : history

    return [...items].sort((left, right) => {
      if (historySort === 'oldest') return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
      if (historySort === 'words') return right.result.fillerWords - left.result.fillerWords
      if (historySort === 'rate') return right.result.relativeRate - left.result.relativeRate
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    })
  }, [history, historyFilter, historySort])

  const addWord = () => {
    const word = newWord.trim().toLowerCase()
    if (word && !words.includes(word)) {
      setWords([...words, word])
      setNewWord('')
    }
  }

  const saveWord = (oldWord: string) => {
    const word = editValue.trim().toLowerCase()
    if (word && !words.includes(word)) {
      setWords(words.map((item) => (item === oldWord ? word : item)))
      setEditing(null)
    }
  }

  const saveHistoryLabel = (entryId: string) => {
    const label = historyEditValue.trim()
    if (!label) return

    setHistory((current) => current.map((entry) => (
      entry.id === entryId ? { ...entry, sourceLabel: label } : entry
    )))
    setEditingHistoryId(null)
    setHistoryEditValue('')
  }

  const deleteHistoryEntry = (entryId: string) => {
    setHistory((current) => current.filter((entry) => entry.id !== entryId))
    if (activeHistoryId === entryId) {
      setActiveHistoryId(null)
      setResult(null)
    }
  }

  const clearHistory = () => {
    setHistory([])
    setActiveHistoryId(null)
    setResult(null)
  }

  const analyze = async () => {
    if (!file && !url) return

    const controller = new AbortController()
    analysisControllerRef.current = controller
    setIsAnalyzing(true)
    setError('')
    setResult(null)
    setActiveHistoryId(null)
    setProgress({ percent: 5, step: 0, label: url ? 'Lade Video von YouTube...' : 'Audiodatei wird vorbereitet...', remainingSeconds: null })

    const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    currentJobIdRef.current = jobId
    console.log('[Analyze] Starting analysis with jobId:', jobId, { file: file?.name, url, words })

    const body = new FormData()
    body.append('jobId', jobId)
    body.append('words', JSON.stringify(words))
    if (file) body.append('file', file)
    if (url) body.append('url', url)

    let isCompleted = false
    let pollerInterval: any = null

    const handleProgressUpdate = (data: any) => {
      if (isCompleted) return

      if (data.stage || data.message) {
        setProgress((prev) => ({
          ...prev,
          label: data.message || prev.label,
          step: data.stage === 'download' ? 0 : data.stage === 'converting' ? 1 : 2,
        }))
      }

      if (data.percent !== undefined) {
        const remainingSeconds = data.duration && data.currentTime && data.currentTime > 0
          ? Math.max(0, Math.round((data.duration - data.currentTime) * 1.0))
          : null

        setProgress({
          percent: data.percent || 10,
          step: 2,
          label: `Whisper KI analysiert... (${Math.round(data.currentTime || 0)}s / ${Math.round(data.duration || 0)}s)`,
          remainingSeconds,
        })
      }

      if (data.text || (data.segments && data.segments.length > 0)) {
        setResult({
          text: data.text || data.partialText || '',
          duration: data.duration || 0,
          counts: data.counts || {},
          fillerWords: data.fillerWords || 0,
          baseFillerWords: data.baseFillerWords || 0,
          totalWords: data.totalWords || 0,
          relativeRate: data.relativeRate || 0,
          segments: data.segments || [],
        })
      }

      if (data.status === 'complete' || data.type === 'complete') {
        const finalResult = data.result || {
          text: data.text || '',
          duration: data.duration || 0,
          counts: data.counts || {},
          fillerWords: data.fillerWords || 0,
          baseFillerWords: data.baseFillerWords || 0,
          totalWords: data.totalWords || 0,
          relativeRate: data.relativeRate || 0,
          segments: data.segments || [],
        }

        isCompleted = true
        if (pollerInterval) clearInterval(pollerInterval)
        console.log('[Analyze] Complete! Final result:', finalResult)
        setResult(finalResult)
        setProgress({ percent: 100, step: progressSteps.length - 1, label: 'Ergebnis fertig', remainingSeconds: 0 })

        const fallbackTitle = url || file?.name || 'Unbekannte Quelle'
        const historyEntry: HistoryEntry = {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          source: fallbackTitle,
          sourceLabel: fallbackTitle,
          createdAt: new Date().toISOString(),
          result: finalResult,
          words: [...words],
          title: analysisTitle.trim() || fallbackTitle,
          note: analysisNote.trim(),
          tags: analysisTags.split(',').map((tag) => tag.trim()).filter(Boolean),
        }

        setHistory((current) => [historyEntry, ...current].slice(0, 50))
        setActiveHistoryId(historyEntry.id)
        setIsAnalyzing(false)
      }
    }

    // Start background status polling in case proxy buffers or drops the SSE POST stream
    pollerInterval = setInterval(async () => {
      if (controller.signal.aborted || isCompleted) {
        if (pollerInterval) clearInterval(pollerInterval)
        return
      }
      try {
        const res = await fetch(`/api/analyze-status/${jobId}`)
        if (res.ok) {
          const statusData = await res.json()
          if (statusData.status === 'running' || statusData.status === 'initializing') {
            handleProgressUpdate(statusData)
          } else if (statusData.status === 'complete') {
            handleProgressUpdate(statusData)
          } else if (statusData.status === 'error') {
            if (pollerInterval) clearInterval(pollerInterval)
            setError(statusData.error || 'Analyse fehlgeschlagen.')
            setIsAnalyzing(false)
          }
        }
      } catch {}
    }, 800)

    try {
      console.log('[Analyze] Sending POST /api/analyze...')
      const response = await fetch('/api/analyze', {
        method: 'POST',
        body,
        signal: controller.signal,
      })

      if (!response.ok && !isCompleted) {
        let errorMsg = `Server-Fehler (${response.status})`
        try {
          const text = await response.text()
          try {
            const json = JSON.parse(text)
            if (json.error) errorMsg = json.error
          } catch {
            if (text.includes('502 Bad Gateway')) {
              errorMsg = '502 Bad Gateway: Der Serverdienst ist nicht erreichbar.'
            } else if (text && text.length < 300 && !text.includes('<html')) {
              errorMsg = text
            }
          }
        } catch {}
        throw new Error(errorMsg)
      }

      if (response.body) {
        const reader = response.body.getReader()
        const decoder = new TextDecoder('utf-8')
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || trimmed.startsWith(':')) continue
            if (!trimmed.startsWith('data:')) continue
            const payload = trimmed.replace(/^data:\s*/, '')
            if (!payload) continue

            let event: any
            try {
              event = JSON.parse(payload)
            } catch {
              continue
            }

            if (event.type === 'status') {
              handleProgressUpdate(event)
            } else if (event.type === 'progress') {
              handleProgressUpdate(event)
            } else if (event.type === 'complete') {
              handleProgressUpdate(event)
            } else if (event.type === 'error') {
              throw new Error(event.error || 'Analyse fehlgeschlagen.')
            }
          }
        }
      }
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === 'AbortError') {
        console.log('[Analyze] User aborted analysis.')
        if (pollerInterval) clearInterval(pollerInterval)
        try { fetch(`/api/analyze-cancel/${jobId}`, { method: 'POST' }).catch(() => {}) } catch {}
        setProgress({ percent: 0, step: 0, label: 'Analyse abgebrochen', remainingSeconds: null })
        setIsAnalyzing(false)
        return
      }

      // If already marked completed by poller, ignore fetch closure errors
      if (isCompleted) return

      console.warn('[Analyze] SSE stream error or closed, polling will continue:', requestError)
      // Wait up to 3 seconds to see if poller gets final status
      setTimeout(() => {
        if (!isCompleted && pollerInterval) {
          clearInterval(pollerInterval)
          let errorMsg = requestError instanceof Error ? requestError.message : 'Analyse fehlgeschlagen.'
          setError(errorMsg)
          setProgress({ percent: 0, step: 0, label: 'Fehler', remainingSeconds: 0 })
          setIsAnalyzing(false)
        }
      }, 5000)
    } finally {
      analysisControllerRef.current = null
    }
  }

  const cancelAnalysis = () => {
    analysisControllerRef.current?.abort()
    const activeId = currentJobIdRef.current
    if (activeId) {
      try {
        fetch(`/api/analyze-cancel/${activeId}`, { method: 'POST' }).catch(() => {})
      } catch {}
    }
    setIsAnalyzing(false)
    setProgress({ percent: 0, step: 0, label: 'Analyse abgebrochen', remainingSeconds: null })
  }

  return (
    <main>
      <nav className="topbar">
        <button className="brand" onClick={() => setView('analyse')} type="button">
          <img className="brand-logo-img" src="/logo.png" alt="ähzähler Logo" />
          <span className="brand-title">ähzähler</span>
        </button>
        <div className="nav-actions">
          <button className={view === 'analyse' ? 'nav-link active' : 'nav-link'} onClick={() => setView('analyse')} type="button">Analyse</button>
          <button className={view === 'live' ? 'nav-link active' : 'nav-link'} onClick={() => setView('live')} type="button">🔴 Live Studio</button>
          <button className={view === 'settings' ? 'nav-link active' : 'nav-link'} onClick={() => setView('settings')} type="button">Settings</button>
          <button
            type="button"
            className="dark-toggle"
            onClick={() => setDarkMode(!darkMode)}
            title={darkMode ? 'Light Mode' : 'Dark Mode'}
            aria-label="Dark Mode umschalten"
          >
            {darkMode ? '☀️' : '🌙'}
          </button>
          <span className="nav-status"><i /> Analyse-Studio</span>
        </div>
      </nav>

      {view === 'settings' ? (
        <Settings
          words={words}
          setWords={setWords}
          newWord={newWord}
          setNewWord={setNewWord}
          editing={editing}
          setEditing={setEditing}
          editValue={editValue}
          setEditValue={setEditValue}
          addWord={addWord}
          saveWord={saveWord}
        />
      ) : view === 'live' ? (
        <LiveStudio words={words} />
      ) : (
        <>
          <section className="intro">
            <p className="eyebrow">SPRECHFLUSS SICHTBAR MACHEN</p>
            <h1>Wie oft sagst du<br /><em>„äh“?</em></h1>
            <p className="intro-copy">Lade eine Aufnahme hoch oder füge einen Link ein. Wir finden deine Füllwörter in wenigen Sekunden.</p>
          </section>

          <section className="workspace">
            <div className="panel input-panel">
                  <div className="panel-heading">
                <div><span className="step">01</span><h2>Quelle wählen</h2></div>
                <span className="format-note">MP3 · MP4</span>
              </div>

              <div className="source-options">
                <div
                  className="dropzone"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault()
                    setFile(event.dataTransfer.files[0] || null)
                    setResult(null)
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/mpeg,video/mp4,.mp3,.mp4"
                    onChange={(event) => {
                      setFile(event.target.files?.[0] || null)
                      setResult(null)
                    }}
                  />
                  <div className="upload-symbol">↑</div>
                  <strong>{file?.name || 'Datei hochladen'}</strong>
                  <span>{file ? 'Bereit für die Analyse' : 'MP3 oder MP4 hier ablegen'}</span>
                </div>

                <div className="or-divider"><span>oder</span></div>

                <div className="url-field-wrap">
                  <label htmlFor="media-url">Link einfügen</label>
                  <div className="url-field">
                    <span>↗</span>
                    <input
                      id="media-url"
                      value={url}
                      onChange={(event) => {
                        setUrl(event.target.value)
                        setResult(null)
                      }}
                      placeholder="https://youtube.com/..."
                    />
                  </div>
                  <small>Direkte Medienlinks werden unterstützt.</small>
                </div>
              </div>

              <div className="analysis-details">
                <input value={analysisTitle} onChange={(event) => setAnalysisTitle(event.target.value)} placeholder="Titel der Analyse (optional)" />
                <input value={analysisTags} onChange={(event) => setAnalysisTags(event.target.value)} placeholder="Tags, z. B. Podcast, Training" />
                <textarea value={analysisNote} onChange={(event) => setAnalysisNote(event.target.value)} placeholder="Notiz zur Aufnahme (optional)" rows={2} />
              </div>

              <button className="analyze-button" type="button" disabled={!isAnalyzing && (!file && !url)} onClick={isAnalyzing ? cancelAnalysis : analyze}>
                <span className="button-label">{isAnalyzing ? 'Analyse abbrechen' : 'Analyse starten'}</span>
                <span className="button-icon-wrap" aria-hidden="true">{isAnalyzing ? '×' : <span className="button-arrow">→</span>}</span>
              </button>

              {isAnalyzing && (
                <div className="progress-panel" aria-live="polite">
                  <div className="progress-header">
                    <span>Analyse läuft</span>
                    <div className="progress-meta">
                      <strong>{progress.percent}%</strong>
                      <span className="progress-time">{progress.remainingSeconds === null ? 'Videolänge wird ermittelt …' : `Restlaufzeit ${formatRemainingTime(progress.remainingSeconds)}`}</span>
                    </div>
                  </div>

                  <div className="progress-bar" aria-hidden="true">
                    <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
                  </div>

                  <div className="progress-label">{progress.label}</div>

                  <div className="progress-steps">
                    {progressSteps.map((step, index) => (
                      <span key={step} className={index <= progress.step ? 'progress-step active' : 'progress-step'}>{step}</span>
                    ))}
                  </div>
                </div>
              )}

              {error && <p className="error-message">{error}</p>}
            </div>

            <div className={result ? 'panel result-panel revealed' : 'panel result-panel'}>
              <div className="panel-heading">
                <div><span className="step">02</span><h2>Dein Ergebnis</h2></div>
                <span className={`live-dot ${isAnalyzing ? 'is-active-dot' : ''}`}>
                  {isAnalyzing ? '● Live-Analyse läuft…' : result ? '● Abgeschlossen' : '● Bereit'}
                </span>
              </div>

              {!result ? (
                isAnalyzing ? (
                  <div className="analyzing-live-hero">
                    <div className="live-status-pill">
                      <span className="live-pulse-beacon"></span>
                      <span>KI-ANALYSE LÄUFT LIVE</span>
                    </div>
                    {currentMediaTitle && (
                      <div className="analyzing-media-callout" title={currentMediaTitle}>
                        <span className="callout-icon">🎬</span>
                        <span className="callout-title">{currentMediaTitle}</span>
                      </div>
                    )}
                    <div className="waveform-equalizer active">
                      <span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span />
                    </div>
                    <div className="analyzing-stage-title">
                      {progress.label || 'Whisper KI transkribiert Audio…'}
                    </div>
                    <div className="analyzing-progress-bar-wrap">
                      <div className="analyzing-progress-bar" style={{ width: `${Math.max(8, progress.percent)}%` }}></div>
                    </div>
                    <div className="analyzing-submeta">
                      <span>Fortschritt: <strong>{Math.round(progress.percent)}%</strong></span>
                      {progress.remainingSeconds !== null && progress.remainingSeconds > 0 && (
                        <span>Restzeit: ca. <strong>{progress.remainingSeconds}s</strong></span>
                      )}
                    </div>
                    <p className="analyzing-hint">
                      ✨ Wörter und Füllwörter werden in Echtzeit erkannt und erscheinen gleich direkt in diesem Dashboard.
                    </p>
                  </div>
                ) : (
                  <div className="empty-result">
                    <div className="waveform"><span /><span /><span /><span /><span /><span /><span /></div>
                    <p>Bereit für die Analyse</p>
                    <small>Lade eine Aufnahme hoch oder füge einen Link ein und starte die Analyse.</small>
                  </div>
                )
              ) : (
                <div className="result-content">
                  {isAnalyzing ? (
                    <div className="live-running-banner">
                      <div className="live-running-header">
                        <span className="live-pulse-beacon"></span>
                        <strong>LIVE-TRANSKRIPTION AKTIV ({Math.round(progress.percent)}%)</strong>
                        <span className="live-badge-tag">Wächst live</span>
                      </div>
                      <div className="live-running-stats">
                        <span>🎙️ <strong>{result.totalWords}</strong> Wörter bisher</span>
                        <span>🚨 <strong>{result.fillerWords}</strong> Füllwörter</span>
                        {progress.remainingSeconds !== null && progress.remainingSeconds > 0 && (
                          <span>⏳ ca. <strong>{progress.remainingSeconds}s</strong> verbleibend</span>
                        )}
                      </div>
                      <div className="live-running-progress-track">
                        <div className="live-running-progress-fill" style={{ width: `${Math.max(5, progress.percent)}%` }}></div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="complete-banner">
                        <div className="complete-badge-content">
                          <span className="complete-badge-icon">✓</span>
                          <div>
                            <strong>Analyse erfolgreich abgeschlossen</strong>
                            <span className="complete-badge-sub">
                              {result.totalWords} gesprochene Wörter • {formatTimestamp(result.duration)} Min. • {result.fillerWords} Füllwörter ({((result.relativeRate || 0) * 100).toFixed(1)}%)
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="report-action-bar">
                        <button
                          type="button"
                          className="report-btn report-btn-copy"
                          onClick={copyTextSummary}
                          title="Formatierte Zusammenfassung kopieren (für E-Mail, YouTube-Kommentare etc.)"
                        >
                          {copyStatus === 'copied' ? '✓ Text kopiert!' : '📋 Text-Bericht kopieren'}
                        </button>
                        <button
                          type="button"
                          className="report-btn report-btn-img"
                          onClick={downloadReportCardImage}
                          title="Als gestaltete Report-Grafik (PNG) herunterladen"
                        >
                          📸 Als Bild speichern
                        </button>
                        <button
                          type="button"
                          className="report-btn report-btn-pdf"
                          onClick={printPdfReport}
                          title="Als 1-seitiges PDF drucken oder speichern"
                        >
                          📄 PDF drucken
                        </button>
                      </div>
                    </>
                  )}

                  <div className="result-source">
                    <div className="source-headline">
                      <span>Video / Quelle</span>
                      <span className={`source-tag ${isAnalyzing ? 'source-tag-live' : ''}`}>
                        {isAnalyzing ? '⚡ Live-Zählung aktiv' : 'Fertig analysiert'}
                      </span>
                    </div>
                    <strong>{activeSourceLabel || url || file?.name || 'YouTube Video'}</strong>
                  </div>

                  <div className="main-count">
                    <strong className={isAnalyzing ? 'count-pulsing' : ''}>{result.fillerWords}</strong>
                    <span>
                      Füllwörter gesamt {isAnalyzing && <span className="live-pill-inline">LIVE</span>}
                      <br />
                      <small>(bereinigt: {result.baseFillerWords ?? result.fillerWords})</small>
                    </span>
                  </div>

                  <div className="metrics">
                    <div>
                      <b>Gesprochene Wörter</b>
                      <strong>{result.totalWords}</strong>
                      <span>absolut</span>
                    </div>
                    <div>
                      <b>Füllwörter</b>
                      <strong>{result.fillerWords}</strong>
                      <span>absolut</span>
                    </div>
                    <div>
                      <b>Füllwort-Anteil</b>
                      <strong>{(result.relativeRate * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %</strong>
                      <span>relativ</span>
                    </div>
                  </div>

                  {(() => {
                    const advice = getOptimizationAdvice(result)
                    return (
                      <div className={`optimization-card ${advice.tone}`}>
                        <div className="optimization-heading">
                          <div>
                            <span className="optimization-kicker">Sprechfluss</span>
                            <h3>{advice.title}</h3>
                          </div>
                          <strong>{advice.rate.toLocaleString('de-DE', { maximumFractionDigits: 1 })}<span>/min</span></strong>
                        </div>
                        <p>{advice.summary}</p>
                        <div className="optimization-tips">
                          {advice.tips.map((tip) => <span key={tip}>{tip}</span>)}
                        </div>
                        <a href="https://www.steffischwarzack.de/blog/aehm-wie-du-laestige-fuellwoerter-beim-sprechen-vermeidest/" target="_blank" rel="noreferrer">Mehr über Pausen und Füllwörter</a>
                      </div>
                    )
                  })()}

                  <div className="breakdown">
                    {words.slice(0, 3).map((word) => (
                      <div key={word}>
                        <b>„{word}"</b>
                        <strong>{result.counts[word] || 0}</strong>
                        <span>Treffer</span>
                      </div>
                    ))}
                  </div>

                  {/* Word Cloud */}
                  {(() => {
                    const allCounts = Object.entries(result.counts).filter(([, c]) => c > 0)
                    if (!allCounts.length) return null
                    const maxCount = Math.max(...allCounts.map(([, c]) => c))
                    return (
                      <div className="word-cloud-card">
                        <div className="section-label">☁️ Wort-Wolke (Deine Suchwörter)</div>
                        <div className="word-cloud">
                          {allCounts
                            .sort(([, a], [, b]) => b - a)
                            .map(([word, count]) => {
                              const ratio = count / maxCount
                              const size = Math.round(13 + ratio * 26)
                              const colorClass = ratio > 0.7 ? 'wc-hot' : ratio > 0.35 ? 'wc-warm' : 'wc-cool'
                              return (
                                <span
                                  key={word}
                                  className={`word-cloud-bubble ${colorClass}`}
                                  style={{ fontSize: `${size}px` }}
                                  title={`„${word}": ${count}×`}
                                >
                                  {word}<sup>{count}</sup>
                                </span>
                              )
                            })}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Automatic Crutch Words & Repetitive Phrases Detector */}
                  {detectedCrutchWords.length > 0 && (
                    <div className="crutch-words-card">
                      <div className="section-label">🔄 Automatisch erkannte Floskeln & Wiederholungen</div>
                      <p style={{ fontSize: '11px', color: 'var(--muted)', margin: '4px 0 8px' }}>
                        Diese Wörter/Floskeln wurden im Text besonders häufig verwendet. Füge sie mit einem Klick zu deiner Suchliste hinzu:
                      </p>
                      <div className="crutch-list">
                        {detectedCrutchWords.map((item) => (
                          <div key={item.word} className="crutch-chip">
                            <span>„{item.word}“</span>
                            <strong>{item.count}×</strong>
                            {item.isUnlisted && (
                              <button
                                type="button"
                                title="Zu meinen Suchwörtern hinzufügen"
                                onClick={() => {
                                  if (!words.includes(item.word)) {
                                    const updated = [...words, item.word]
                                    setWords(updated)
                                    localStorage.setItem('fill-words', JSON.stringify(updated))
                                  }
                                }}
                              >
                                + Merken
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Heatmap Timeline */}
                  {(() => {
                    if (!result.segments || !result.duration) return null
                    const BUCKETS = Math.min(200, Math.max(20, Math.round(result.duration)))
                    const bucketDuration = result.duration / BUCKETS
                    const buckets = Array.from({ length: BUCKETS }, (_, i) => {
                      const t0 = i * bucketDuration
                      const t1 = t0 + bucketDuration
                      const count = result.segments
                        .filter((s) => s.start >= t0 && s.start < t1)
                        .reduce((sum, s) => sum + Object.values(s.counts ?? {}).reduce((a, b) => a + b, 0), 0)
                      return { t0, count }
                    })
                    const maxBucket = Math.max(1, ...buckets.map((b) => b.count))
                    return (
                      <div className="heatmap-card">
                        <div className="section-label">🗺️ Heatmap-Timeline — Füllwörter über Zeit (Klick zum Abspielen)</div>
                        <div className="heatmap-strip" aria-label="Füllwort-Heatmap">
                          {buckets.map((bucket, i) => {
                            const intensity = bucket.count / maxBucket
                            const hue = Math.round(120 - intensity * 120)
                            const sat = bucket.count === 0 ? 15 : 80
                            const light = 42 + (1 - intensity) * 22
                            return (
                              <div
                                key={i}
                                className="heatmap-cell"
                                style={{ background: `hsl(${hue}, ${sat}%, ${light}%)` }}
                                title={`${formatTimestamp(bucket.t0)} — ${bucket.count} Füllwort${bucket.count !== 1 ? 'er' : ''} (Klicken zum Anhören)`}
                                onClick={() => seekAndPlay(bucket.t0)}
                              />
                            )
                          })}
                        </div>
                        <div className="heatmap-legend">
                          <span><span className="heatmap-legend-dot" style={{ background: 'hsl(120, 80%, 42%)' }} />Kein Füllwort</span>
                          <span><span className="heatmap-legend-dot" style={{ background: 'hsl(60, 80%, 42%)' }} />Wenige</span>
                          <span><span className="heatmap-legend-dot" style={{ background: 'hsl(0, 80%, 42%)' }} />Viele</span>
                        </div>
                      </div>
                    )
                  })()}

                  <div className="waveform-bar-card">
                    <div className="timeline-header-flex">
                      <div className="section-label">Interaktive Füllwort-Timeline & Player</div>
                      {currentMediaTitle && (
                        <div className="media-pill-tag" title={currentMediaTitle}>
                          <span className="pill-dot">●</span>
                          <span className="pill-text">{currentMediaTitle}</span>
                        </div>
                      )}
                    </div>
                    <div
                      className="waveform-timeline"
                      title="Klicke auf eine Stelle, um dorthin zu springen"
                      onClick={(e) => {
                        if (!result?.duration) return
                        const rect = e.currentTarget.getBoundingClientRect()
                        const clickX = e.clientX - rect.left
                        const ratio = Math.max(0, Math.min(1, clickX / rect.width))
                        seekAndPlay(ratio * result.duration)
                      }}
                    >
                      <div className="timeline-track" />
                      {fillerSegments.map((seg) => {
                        const leftPercent = (seg.start / (result.duration || 1)) * 100
                        const widthPercent = Math.max(0.6, ((seg.end - seg.start) / (result.duration || 1)) * 100)
                        return (
                          <div
                            key={`${seg.start}-${seg.end}`}
                            className="timeline-filler-marker"
                            style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
                            title={`Füllwort bei ${formatTimestamp(seg.start)}: „${seg.text}“`}
                          />
                        )
                      })}
                    </div>

                    <div className="player-extra-controls">
                      <button
                        type="button"
                        className="player-control-button"
                        onClick={() => jumpToFiller('prev')}
                        disabled={!fillerSegments.length}
                      >
                        ⏮️ Vorheriges Füllwort
                      </button>
                      <button
                        type="button"
                        className="player-control-button"
                        onClick={() => jumpToFiller('next')}
                        disabled={!fillerSegments.length}
                      >
                        ⏭️ Nächstes Füllwort
                      </button>
                      <button
                        type="button"
                        className={isSupercutActive ? 'player-control-button active' : 'player-control-button'}
                        onClick={() => setIsSupercutActive(!isSupercutActive)}
                        disabled={!fillerSegments.length}
                      >
                        🎧 {isSupercutActive ? 'Supercut beenden' : 'Füllwort-Supercut abspielen'}
                      </button>
                    </div>
                    {isSupercutActive && fillerSegments.length > 0 && (
                      <div className="supercut-badge">
                        ⚡ Supercut läuft: Füllwort {supercutCurrentIndex + 1} von {fillerSegments.length}
                      </div>
                    )}
                  </div>

                  {activeYoutubeId && (
                    <div className="youtube-player-card">
                      <div className="video-player-header">
                        <div className="video-player-title-info">
                          <span className="video-badge">📺 YOUTUBE SYNC-PLAYER</span>
                          <h4 className="video-name-heading" title={currentMediaTitle}>
                            🎬 {currentMediaTitle || 'YouTube Video'}
                          </h4>
                        </div>
                        <span className="video-sync-subhint">Klick auf Transkript springt im Video</span>
                      </div>
                      <div className="youtube-player-wrap">
                        <iframe
                          id="youtube-sync-iframe"
                          key={activeYoutubeId}
                          src={`https://www.youtube-nocookie.com/embed/${activeYoutubeId}?enablejsapi=1&version=3&rel=0&autoplay=0`}
                          title={currentMediaTitle || 'YouTube Sync Video'}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          allowFullScreen
                        />
                      </div>
                    </div>
                  )}

                  <div className="eraser-card">
                    <div className="eraser-header">
                      <div className="eraser-icon">✂️</div>
                      <div>
                        <h3>Füllwort-Eraser</h3>
                        <p>Erstelle automatisch eine neue MP3-Audiodatei, aus der alle erkannten Füllwörter herausgeschnitten wurden.</p>
                      </div>
                    </div>
                    {cleanAudioError && <p className="error-message">{cleanAudioError}</p>}
                    <button
                      type="button"
                      className="eraser-button"
                      onClick={downloadCleanAudio}
                      disabled={isCleaningAudio || !result?.fillerWords}
                    >
                      {isCleaningAudio ? 'Bereinigung läuft …' : 'Audio ohne Füllwörter herunterladen (MP3)'}
                    </button>
                  </div>

                  <div className="transcript-card">
                    <div className="section-label">Transkript mit Zeitstempeln (Klicken zum Anhören)</div>
                    {file && <audio className="playback" ref={playbackRef} src={playbackUrl} controls />}
                    <div className="transcript-list">
                      {(result.segments || []).map((segment) => (
                        <button
                          className="transcript-segment"
                          type="button"
                          key={`${segment.start}-${segment.end}`}
                          onClick={() => seekAndPlay(segment.start)}
                        >
                          <span>{formatTimestamp(segment.start)}</span>
                          <strong>{segment.text}</strong>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="timeline">
                    <div className="timeline-label">
                      <span>Transkription abgeschlossen</span>
                      <span>{Math.floor(result.duration / 60)}:{String(Math.round(result.duration % 60)).padStart(2, '0')} min</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {history.length > 0 && (
            <section className="history-section">
                  <div className="panel history-panel">
                <div className="panel-heading history-head">
                  <div><span className="step">03</span><h2>Warteschlange</h2></div>
                  <span className="history-caption">Jede Analyse bleibt abrufbar</span>
                  <button className="history-clear-button" type="button" onClick={clearHistory}>Alle löschen</button>

                  <div className="history-tools">
                    <input
                      value={historyFilter}
                      onChange={(event) => setHistoryFilter(event.target.value)}
                      placeholder="Suche nach Video oder Link"
                    />
                    <select
                      value={historySort}
                      onChange={(event) => setHistorySort(event.target.value as 'newest' | 'oldest' | 'words' | 'rate')}
                    >
                      <option value="newest">Neueste zuerst</option>
                      <option value="oldest">Älteste zuerst</option>
                      <option value="words">Nach Füllwörtern</option>
                      <option value="rate">Nach Anteil</option>
                    </select>
                  </div>
                </div>

                {filteredHistory.length === 0 && (
                  <div className="history-empty-state">
                    Noch keine Einträge. Analysiere ein Video, damit du Vergleiche später im Verlauf sehen kannst.
                  </div>
                )}

                <div className="history-table-wrap">
                  <table className="history-table">
                    <thead>
                      <tr>
                        <th>Video</th>
                        <th>Datum</th>
                        <th>Füllwörter</th>
                        <th>Gesamt</th>
                        <th>Anteil</th>
                        <th>Ergebnis</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredHistory.map((entry) => (
                        <tr key={entry.id} className={entry.id === activeHistoryId ? 'active-history-row' : undefined}>
                          <td className="history-link-cell">
                            <strong className="history-title" title={entry.note || undefined}>{entry.title || entry.sourceLabel}</strong>
                            {entry.tags?.length > 0 && <span className="history-tags">{entry.tags.join(' · ')}</span>}
                            {editingHistoryId === entry.id ? (
                              <input
                                className="history-edit-input"
                                value={historyEditValue}
                                onChange={(event) => setHistoryEditValue(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') saveHistoryLabel(entry.id)
                                  if (event.key === 'Escape') setEditingHistoryId(null)
                                }}
                                autoFocus
                              />
                            ) : entry.source.startsWith('http') ? (
                              <a href={entry.source} target="_blank" rel="noreferrer">{entry.sourceLabel}</a>
                            ) : (
                              <span>{entry.sourceLabel}</span>
                            )}
                          </td>
                          <td>{new Date(entry.createdAt).toLocaleDateString('de-DE')}</td>
                          <td>{entry.result.fillerWords}</td>
                          <td>{entry.result.totalWords}</td>
                          <td>{(entry.result.relativeRate * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })}%</td>
                          <td>
                            <div className="history-actions">
                              <button
                                type="button"
                                className="history-result-button"
                                onClick={() => {
                                  setResult(entry.result)
                                  setActiveHistoryId(entry.id)
                                  setUrl(entry.source.startsWith('http') ? entry.source : '')
                                  setFile(null)
                                  setView('analyse')
                                }}
                              >Öffnen</button>
                              {editingHistoryId === entry.id ? (
                                <button type="button" className="history-icon-button" onClick={() => saveHistoryLabel(entry.id)} title="Namen speichern">✓</button>
                              ) : (
                                <button type="button" className="history-icon-button" onClick={() => { setEditingHistoryId(entry.id); setHistoryEditValue(entry.sourceLabel) }} title="Namen bearbeiten">✎</button>
                              )}
                              <button type="button" className="history-icon-button danger" onClick={() => deleteHistoryEntry(entry.id)} title="Analyse löschen">×</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          <footer>
            <span>ähzähler / 2026</span>
            <span>Entwickelt für klarere Gedanken</span>
          </footer>
        </>
      )}
    </main>
  )
}

function Settings({
  words,
  setWords,
  newWord,
  setNewWord,
  editing,
  setEditing,
  editValue,
  setEditValue,
  addWord,
  saveWord,
}: {
  words: string[]
  setWords: (words: string[]) => void
  newWord: string
  setNewWord: (value: string) => void
  editing: string | null
  setEditing: (word: string | null) => void
  editValue: string
  setEditValue: (value: string) => void
  addWord: () => void
  saveWord: (word: string) => void
}) {
  return (
    <section className="settings-view">
      <p className="eyebrow">DEINE AUSWERTUNG</p>
      <h1>Füllwörter<br /><em>verwalten.</em></h1>
      <p className="intro-copy">Lege fest, nach welchen Wörtern gesucht werden soll. Änderungen werden automatisch lokal gespeichert.</p>

      <div className="settings-panel">
        <div className="panel-heading">
          <div><span className="step">01</span><h2>Suchbegriffe</h2></div>
          <span className="format-note">{words.length} aktiv</span>
        </div>

        <div className="word-list">
          {words.map((word) => (
            <div className="word-row" key={word}>
              {editing === word ? (
                <input
                  className="edit-input"
                  value={editValue}
                  onChange={(event) => setEditValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') saveWord(word)
                    if (event.key === 'Escape') setEditing(null)
                  }}
                  autoFocus
                />
              ) : (
                <span className="word-label">„{word}“</span>
              )}

              <div className="row-actions">
                {editing === word ? (
                  <button className="icon-button" onClick={() => saveWord(word)} type="button" title="Speichern">✓</button>
                ) : (
                  <button
                    className="icon-button"
                    onClick={() => {
                      setEditing(word)
                      setEditValue(word)
                    }}
                    type="button"
                    title="Bearbeiten"
                  >✎</button>
                )}

                <button className="icon-button danger" onClick={() => setWords(words.filter((item) => item !== word))} type="button" title="Löschen">×</button>
              </div>
            </div>
          ))}
        </div>

        <div className="add-word">
          <input
            value={newWord}
            onChange={(event) => setNewWord(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addWord()
            }}
            placeholder="Neues Füllwort"
          />
          <button type="button" onClick={addWord}>Hinzufügen <span>+</span></button>
        </div>
      </div>
    </section>
  )
}

// Multi-variant mappings for common German hesitation sounds and filler phrases
const FILLER_VARIANT_MAP: Record<string, string[][]> = {
  "äh": [["äh", "ä", "ah", "aeh", "eh", "öh", "oeh", "ähh", "ähhh", "uh", "er"]],
  "ähm": [["ähm", "aehm", "ehm", "öhm", "ahm", "hm", "hmm", "hmmm", "uhm", "erm", "äm", "aem"]],
  "also äh": [["also"], ["äh", "ä", "ah", "aeh", "eh", "öh", "oeh", "ähh", "ähhh", "uh", "er"]],
  "also ähm": [["also"], ["ähm", "aehm", "ehm", "öhm", "ahm", "hm", "hmm", "hmmm", "uhm", "erm", "äm", "aem"]],
  "aber äh": [["aber"], ["äh", "ä", "ah", "aeh", "eh", "öh", "oeh", "ähh", "ähhh", "uh", "er"]],
  "aber ähm": [["aber"], ["ähm", "aehm", "ehm", "öhm", "ahm", "hm", "hmm", "hmmm", "uhm", "erm", "äm", "aem"]],
  "und äh": [["und"], ["äh", "ä", "ah", "aeh", "eh", "öh", "oeh", "ähh", "ähhh", "uh", "er"]],
  "und ähm": [["und"], ["ähm", "aehm", "ehm", "öhm", "ahm", "hm", "hmm", "hmmm", "uhm", "erm", "äm", "aem"]],
  "sozusagen": [["sozusagen", "sozusagn"]],
  "eigentlich": [["eigentlich"]],
  "quasi": [["quasi"]],
  "praktisch": [["praktisch"]],
  "halt": [["halt"]],
  "irgendwie": [["irgendwie"]],
  "im grunde": [["im", "in"], ["grunde", "grund"]],
  "im endeffekt": [["im", "in"], ["endeffekt"]]
}

function countTargetInTokens(tokens: string[], target: string): number {
  const normTarget = target.toLowerCase().trim()
  const patternSlots: string[][] = FILLER_VARIANT_MAP[normTarget] || (
    (normTarget.match(/[\p{L}\p{N}]+/gu) || [normTarget]).map((tok) => [tok])
  )

  let count = 0
  const plen = patternSlots.length
  if (plen === 0 || tokens.length < plen) return 0

  for (let i = 0; i <= tokens.length - plen; i++) {
    let match = true
    for (let j = 0; j < plen; j++) {
      if (!patternSlots[j].includes(tokens[i + j])) {
        match = false
        break
      }
    }
    if (match) {
      count++
      if (plen > 1) {
        i += plen - 1
      }
    }
  }
  return count
}

function LiveStudio({ words }: { words: string[] }) {
  const [isListening, setIsListening] = useState(false)
  const [liveCount, setLiveCount] = useState(0)
  const [wordCounts, setWordCounts] = useState<Record<string, number>>({})
  const [liveTranscript, setLiveTranscript] = useState<string>('')
  const [lastAlert, setLastAlert] = useState<string | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [speechPace, setSpeechPace] = useState(0)
  const [wpmHistory, setWpmHistory] = useState<number[]>([])
  const [isAmbientAlert, setIsAmbientAlert] = useState(false)
  const recognitionRef = useRef<any>(null)
  const timerRef = useRef<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wpmCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const particleCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const particlesRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; alpha: number; color: string }>>([])
  const particleAnimRef = useRef<number | null>(null)
  const counterRef = useRef<HTMLSpanElement | null>(null)
  const transcriptBoxRef = useRef<HTMLDivElement | null>(null)
  // Ref for elapsedSeconds so onresult closure always has the current value (avoids stale closure, WPM=0 bug)
  const elapsedSecondsRef = useRef(0)
  // Segment-by-segment filler counts that permanently lock in interim and final filler hits across all spoken phrases
  const segmentFillersRef = useRef<Map<number, Record<string, number>>>(new Map())

  // Auto-scroll transcript box to bottom on new content
  useEffect(() => {
    const box = transcriptBoxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [liveTranscript])

  // Track whether counter popped this cycle
  const popCounterAnimation = () => {
    const el = counterRef.current
    if (!el) return
    el.classList.remove('counter-pop')
    void el.offsetWidth // reflow to restart
    el.classList.add('counter-pop')
  }

  // Spawn particles on filler word detection
  const spawnParticles = () => {
    const canvas = particleCanvasRef.current
    if (!canvas) return
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    const colors = ['#f37d21', '#ef4444', '#ffb800', '#ff6b6b', '#fbbf24']
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 2 + Math.random() * 4
      particlesRef.current.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        alpha: 1,
        color: colors[Math.floor(Math.random() * colors.length)],
      })
    }
    if (!particleAnimRef.current) animateParticles()
  }

  const animateParticles = () => {
    const canvas = particleCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    particlesRef.current = particlesRef.current.filter((p) => p.alpha > 0.02)
    for (const p of particlesRef.current) {
      p.x += p.vx; p.y += p.vy
      p.vy += 0.15 // gravity
      p.alpha -= 0.022
      ctx.save()
      ctx.globalAlpha = Math.max(0, p.alpha)
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    if (particlesRef.current.length > 0) {
      particleAnimRef.current = requestAnimationFrame(animateParticles)
    } else {
      particleAnimRef.current = null
    }
  }

  // Draw rolling WPM chart
  useEffect(() => {
    const canvas = wpmCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width
    const H = canvas.height
    ctx.clearRect(0, 0, W, H)

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.1)'
    ctx.fillRect(0, 0, W, H)

    if (wpmHistory.length < 2) return

    const maxWpm = Math.max(240, ...wpmHistory)
    const RECOMMEND = 120
    const FAST = 180

    // Reference lines
    const drawRefLine = (wpm: number, color: string, label: string) => {
      const y = H - (wpm / maxWpm) * H
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = color
      ctx.font = '10px system-ui'
      ctx.fillText(label, 4, y - 3)
    }
    drawRefLine(RECOMMEND, 'rgba(0,230,118,0.7)', `${RECOMMEND} WPM`)
    drawRefLine(FAST, 'rgba(255,107,107,0.7)', `${FAST} WPM`)

    // WPM line
    const lastWpm = wpmHistory[wpmHistory.length - 1]
    const gradient = ctx.createLinearGradient(0, 0, 0, H)
    gradient.addColorStop(0, lastWpm > FAST ? '#ff6b6b' : '#00e676')
    gradient.addColorStop(1, 'rgba(0,230,118,0.1)')
    ctx.strokeStyle = lastWpm > FAST ? '#ff6b6b' : '#00e676'
    ctx.lineWidth = 2.5
    ctx.shadowColor = lastWpm > FAST ? '#ff6b6b' : '#00e676'
    ctx.shadowBlur = 8
    ctx.beginPath()
    const step = W / (wpmHistory.length - 1)
    wpmHistory.forEach((wpm, i) => {
      const x = i * step
      const y = H - (wpm / maxWpm) * H
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    })
    ctx.stroke()
    ctx.shadowBlur = 0
  }, [wpmHistory])

  // Ambient alert: >5 fillers per minute rate
  useEffect(() => {
    if (!isListening || elapsedSeconds < 10) return
    const perMin = (liveCount / elapsedSeconds) * 60
    setIsAmbientAlert(perMin > 5)
  }, [liveCount, elapsedSeconds, isListening])

  useEffect(() => {
    if (!isListening) {
      if (timerRef.current) window.clearInterval(timerRef.current)
      return
    }

    timerRef.current = window.setInterval(() => {
      setElapsedSeconds((sec) => {
        const next = sec + 1
        elapsedSecondsRef.current = next  // keep ref in sync so onresult closure has current value
        return next
      })
    }, 1000)


    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [isListening])

  const startVisualizer = async (stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      const audioCtx = new AudioCtx()
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 128

      const source = audioCtx.createMediaStreamSource(stream)
      source.connect(analyser)

      audioContextRef.current = audioCtx

      const bufferLength = analyser.frequencyBinCount
      const freqData = new Uint8Array(bufferLength)
      const timeData = new Uint8Array(bufferLength)

      const draw = () => {
        animFrameRef.current = requestAnimationFrame(draw)
        analyser.getByteFrequencyData(freqData)
        analyser.getByteTimeDomainData(timeData)

        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        ctx.clearRect(0, 0, canvas.width, canvas.height)

        // 1. Draw background frequency volume bars
        const barWidth = canvas.width / bufferLength
        let x = 0
        let maxVol = 0

        for (let i = 0; i < bufferLength; i++) {
          const v = freqData[i]
          if (v > maxVol) maxVol = v
          const barHeight = (v / 255) * canvas.height * 0.75
          ctx.fillStyle = `rgba(243, 125, 33, ${Math.max(0.12, v / 300)})`
          ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight)
          x += barWidth
        }

        // 2. Draw real-time oscilloscope waveform line over voice audio
        ctx.lineWidth = 2.5
        const isSpeaking = maxVol > 25
        ctx.strokeStyle = isSpeaking ? '#00e676' : '#ff9800'
        ctx.shadowColor = isSpeaking ? '#00e676' : 'rgba(255, 152, 0, 0.4)'
        ctx.shadowBlur = isSpeaking ? 10 : 4
        ctx.beginPath()

        const sliceWidth = canvas.width / bufferLength
        let waveX = 0

        for (let i = 0; i < bufferLength; i++) {
          const v = timeData[i] / 128.0
          const y = (v * canvas.height) / 2

          if (i === 0) {
            ctx.moveTo(waveX, y)
          } else {
            ctx.lineTo(waveX, y)
          }
          waveX += sliceWidth
        }

        ctx.lineTo(canvas.width, canvas.height / 2)
        ctx.stroke()
        ctx.shadowBlur = 0
      }
      draw()
    } catch (err) {
      console.error('Audio visualizer error:', err)
    }
  }

  const stopVisualizer = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    if (audioContextRef.current) void audioContextRef.current.close()
    audioContextRef.current = null
    animFrameRef.current = null
  }

  const startListening = async () => {
    console.log("[LiveStudio] startListening() called");
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    console.log("[LiveStudio] SpeechRecognition available:", !!SpeechRecognition);
    if (!SpeechRecognition) {
      alert("Dein Browser unterstützt keine Echtzeit-Spracherkennung. Bitte nutze Google Chrome oder MS Edge für das Live Studio.");
      return;
    }

    try {
      console.log("[LiveStudio] Requesting microphone...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("[LiveStudio] Microphone granted, tracks:", stream.getTracks().length);
      void startVisualizer(stream);

      console.log("[LiveStudio] Starting SpeechRecognition, words:", words);
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "de-DE";
      recognition.maxAlternatives = 3;

      recognition.onresult = (event: any) => {
        let finalText = "";
        let interimText = "";

        for (let i = 0; i < event.results.length; i++) {
          const res = event.results[i];
          const isFinal = res.isFinal;
          const primaryTranscript = res[0]?.transcript || "";

          if (isFinal) {
            finalText += (finalText ? " " : "") + primaryTranscript.trim();
          } else {
            interimText += (interimText ? " " : "") + primaryTranscript.trim();
          }

          // Extract all alternative texts for segment i
          const allAlts: string[] = [];
          for (let alt = 0; alt < res.length; alt++) {
            const altText = res[alt]?.transcript;
            if (altText) allAlts.push(altText);
          }
          if (allAlts.length === 0 && primaryTranscript) {
            allAlts.push(primaryTranscript);
          }

          // Compute max occurrence for each search word in segment i across alternatives
          const segExisting = segmentFillersRef.current.get(i) || {};
          const segUpdated: Record<string, number> = { ...segExisting };

          for (const w of words) {
            const bestForThisAltScan = Math.max(
              0,
              ...allAlts.map((text) => {
                const toks = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
                return countTargetInTokens(toks, w);
              })
            );
            // Lock in occurrences so even if finalized text drops hesitation sounds, they remain counted
            segUpdated[w] = Math.max(segExisting[w] || 0, bestForThisAltScan);
          }

          segmentFillersRef.current.set(i, segUpdated);
        }

        // Sum counts for all words across all segments
        const totalCounts: Record<string, number> = {};
        for (const w of words) totalCounts[w] = 0;
        segmentFillersRef.current.forEach((segCounts) => {
          for (const w of words) {
            totalCounts[w] += (segCounts[w] || 0);
          }
        });

        const totalFiller = Object.values(totalCounts).reduce((a, b) => a + b, 0);
        const fullTranscript = (finalText + (interimText ? " " + interimText : "")).trim();

        console.log("[LiveStudio] Transcript:", fullTranscript);
        console.log("[LiveStudio] Total counts:", totalCounts, "Total fillers:", totalFiller);

        setLiveTranscript(fullTranscript);
        setWordCounts(totalCounts);

        // Trigger animations & alerts when count increases
        setLiveCount((prev) => {
          if (totalFiller > prev) {
            popCounterAnimation();
            spawnParticles();
          }
          return totalFiller;
        });

        // WPM calculation
        const secs = elapsedSecondsRef.current;
        const totalTokens = fullTranscript.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
        if (totalTokens.length > 0 && secs > 0) {
          const wpm = Math.round((totalTokens.length / secs) * 60);
          setSpeechPace(wpm);
          setWpmHistory((prev) => {
            const next = [...prev, wpm];
            return next.length > 60 ? next.slice(-60) : next;
          });
        }

        const lastWordMatched = words.find((w) => (totalCounts[w] || 0) > (wordCounts[w] || 0));
        if (lastWordMatched) {
          setLastAlert(`Füllwort erkannt: „${lastWordMatched}"! Kurz innehalten & Stimme absenken.`);
        }
      };

      recognition.onstart = () => {
        console.log("[LiveStudio] recognition.onstart — recognition is running");
      };

      recognition.onerror = (err: any) => {
        console.error("[LiveStudio] recognition.onerror:", err.error, err.message, err);
        if (err.error === "not-allowed") {
          setLastAlert("Mikrofon-Zugriff verweigert. Bitte erlaube den Zugriff in den Browser-Einstellungen.");
        } else if (err.error === "network") {
          setLastAlert("Netzwerkfehler: Spracherkennung benötigt eine Internetverbindung.");
        } else if (err.error !== "no-speech" && err.error !== "aborted") {
          setLastAlert(`Erkennungsfehler: ${err.error}`);
        }
      };

      recognition.onend = () => {
        console.log("[LiveStudio] recognition.onend — restarting:", isListening);
        if (isListening) {
          try { recognition.start(); } catch (restartErr) {
            console.warn("[LiveStudio] Restart failed:", restartErr);
          }
        }
      };

      recognition.start();
      console.log("[LiveStudio] recognition.start() called");
      recognitionRef.current = recognition;
      setIsListening(true);
      setLastAlert("Live-Erkennung aktiv. Sprich frei ins Mikrofon!");
    } catch (e) {
      console.error("[LiveStudio] startListening CATCH:", e);
      const msg = e instanceof Error ? e.message : String(e);
      setLastAlert(`Fehler beim Starten: ${msg}`);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    stopVisualizer();
    setIsListening(false);
  };

  const resetLiveSession = () => {
    stopListening();
    setLiveCount(0);
    setWordCounts({});
    setLiveTranscript("");
    setLastAlert(null);
    setElapsedSeconds(0);
    setSpeechPace(0);
    setWpmHistory([]);
    setIsAmbientAlert(false);
    segmentFillersRef.current.clear();
    particlesRef.current = [];
    const ctx = particleCanvasRef.current?.getContext("2d");
    if (ctx && particleCanvasRef.current) ctx.clearRect(0, 0, particleCanvasRef.current.width, particleCanvasRef.current.height);
  };

  return (
    <section className="live-studio-view">
      <div className="live-studio-header">
        <div className="live-studio-header-titles">
          <span className="eyebrow">ECHTZEIT-SPRECHFLUSS-TRAINER</span>
          <h1>🔴 Live Studio — <em>Präsentation live üben</em></h1>
          <p className="intro-copy">Sprich frei ins Mikrofon. Füllwörter werden live gezählt, dein Ton als Wave visualisiert & dein Tempo getracked.</p>
        </div>
        <div className="live-header-status-badge">
          <span className={isListening ? "live-mic-dot recording" : "live-mic-dot"} />
          <b>{isListening ? "LIVE-ERKENNUNG AKTIV" : "BEREIT"}</b>
        </div>
      </div>

      <div className="live-studio-grid">
        <div className="live-studio-panel left-panel">
          <div className={`live-counter-box${isAmbientAlert ? " ambient-alert" : ""}`}>
            <img src="/logo.png" alt="ähzähler Logo" className="live-logo-badge" />

            {/* Particle canvas overlay */}
            <div className="particle-canvas-wrap">
              <div className="flip-counter-display">
                <span ref={counterRef} className="flip-counter-number">{String(liveCount).padStart(2, "0")}</span>
              </div>
              <canvas ref={particleCanvasRef} width={200} height={120} className="particle-canvas" />
            </div>

            <div className="audio-visualizer-box" title="Echtzeit-Audio-Waveform deines Mikrofons">
              <div className="wave-label"><span>WAVE-SIGNAL DEINER STIMME</span></div>
              <canvas ref={canvasRef} width={280} height={52} className="audio-visualizer-canvas" />
            </div>

            <div className="live-status-indicator">
              <span className={isListening ? "live-mic-dot recording" : "live-mic-dot"} />
              <span>{isListening ? "Mikrofon aktiv · Stimmsignal wird verarbeitet" : "Mikrofon im Standby"}</span>
            </div>
          </div>

          <div className="live-controls">
            {!isListening ? (
              <button type="button" className="live-start-button" onClick={startListening}>
                <span>🎙️ Live-Session starten</span>
              </button>
            ) : (
              <button type="button" className="live-stop-button" onClick={stopListening}>
                <span>⏸️ Pause</span>
              </button>
            )}
            <button type="button" className="history-clear-button" onClick={resetLiveSession}>
              Zurücksetzen
            </button>
          </div>
        </div>

        <div className="live-studio-panel right-panel">
          {lastAlert && (
            <div className="live-alert-banner">
              <span>⚠️</span>
              <span>{lastAlert}</span>
            </div>
          )}

          <div className="live-stats-grid">
            <div className="live-stat-card">
              <b>Dauer</b>
              <strong>{formatTimestamp(elapsedSeconds)} min</strong>
            </div>
            <div className="live-stat-card">
              <b>Füllwörter gesamt</b>
              <strong>{liveCount}</strong>
            </div>
            <div className="live-stat-card">
              <b>Sprechtempo</b>
              <strong>{speechPace} <span style={{ fontSize: "13px", fontWeight: 400 }}>WPM</span></strong>
            </div>
          </div>

          {/* WPM Rolling Chart */}
          <div className="wpm-chart-box">
            <div className="wpm-chart-label">📈 Sprechtempo-Verlauf (letzte 60 Sek.)</div>
            <canvas ref={wpmCanvasRef} width={460} height={70} className="wpm-chart-canvas" />
            {wpmHistory.length < 2 && (
              <div className="wpm-chart-hint">Sprich ins Mikrofon — der Tempo-Graph erscheint hier in Echtzeit</div>
            )}
          </div>

          {/* Live Transcript Box - Front & Center */}
          <div className="live-transcript-box" ref={transcriptBoxRef}>
            <div className="live-transcript-header">
              <span className="live-transcript-title">🎙️ Live Transkript-Stream</span>
              <span className="live-transcript-wordcount">
                {liveTranscript ? `${(liveTranscript.match(/[\p{L}\p{N}]+/gu) || []).length} Wörter erfasst` : "Warten auf Sprache..."}
              </span>
            </div>
            <p className="transcript-text">
              {liveTranscript || (
                <span className="transcript-placeholder">
                  {isListening ? '🎙️ Spracherkennung lauscht... Sprich frei drauflos!' : 'Noch keine Sprache erfasst. Klicke links auf „Live-Session starten“ und sprich ins Mikrofon.'}
                </span>
              )}
            </p>
          </div>

          {/* Search Words Breakdown */}
          <div className="live-breakdown-section">
            <div className="live-breakdown-title">FÜLLWORT-AUFSCHLÜSSELUNG</div>
            <div className="breakdown">
              {words.map((word) => (
                <div key={word} className={(wordCounts[word] || 0) > 0 ? "breakdown-item active-hit" : "breakdown-item"}>
                  <b>„{word}"</b>
                  <strong>{wordCounts[word] || 0}</strong>
                  <span>Treffer</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default App;
