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

  const [fetchedMediaInfo, setFetchedMediaInfo] = useState<{ title: string; duration: number; uploader?: string } | null>(null)
  const [isFetchingMediaInfo, setIsFetchingMediaInfo] = useState(false)
  const [queueInfo, setQueueInfo] = useState<{ position: number; total: number; message: string } | null>(null)
  const [showSelfHostModal, setShowSelfHostModal] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const playbackRef = useRef<HTMLAudioElement>(null)
  const analysisControllerRef = useRef<AbortController | null>(null)
  const currentJobIdRef = useRef<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'copied-comment'>('idle')
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

  const copyFeedbackComment = () => {
    if (!result) return
    const topWords = Object.entries(result.counts || {})
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([w, c]) => `• „${w}“: ${c}×`)
      .join('\n')

    const effectiveFillers = result.baseFillerWords ?? result.fillerWords
    const ratePerMin = result.duration > 0 ? (effectiveFillers / (result.duration / 60)) : 0

    const commentText = `Hallo, das Format ist super und ich schätze eure Inhalte und Themen sehr! Ich würde die Videos gerne voll aufsaugen, allerdings lenken mich häufige Füllwörter wie „äh“ und „ähm“ leider stark vom eigentlichen Inhalt ab.

Ich möchte hier rein konstruktives Feedback dalassen, ohne jemanden verletzen oder angreifen zu wollen. Vor einiger Zeit habe ich bei einem Rhetorik-Seminar gelernt, aktiv auf Füllwörter zu achten – seitdem fallen sie mir beim Zuhören leider extrem auf.

Um das Ganze objektiv und greifbar zu machen, habe ich ein Analysetool („ähm-zähler“) gebaut. Hier ist die Auswertung für dieses Video:

⏱️ Dauer: ${formatTimestamp(result.duration)} Min.
🗣️ Wörter gesamt: ${result.totalWords.toLocaleString('de-DE')}
🚨 Füllwörter gesamt: ${result.fillerWords} (${((result.relativeRate || 0) * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} % — ca. ${ratePerMin.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Füllwörter/Min.)

🔍 Häufigste Füllwörter:
${topWords || '• Keine Füllwörter gefunden'}

Vielleicht hilft euch das Feedback dabei, den Sprechfluss noch weiter zu verfeinern, damit die starken Inhalte noch besser zur Geltung kommen!

🔗 Erstellt mit https://aehm-zaehler.de`

    navigator.clipboard.writeText(commentText).then(() => {
      setCopyStatus('copied-comment')
      setTimeout(() => setCopyStatus('idle'), 2500)
    }).catch(() => {})
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
    ctx.fillText('ähm-zähler', 60, 70)

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
    ctx.fillText('Erstellt mit ähm-zähler (https://aehm-zaehler.de) — Sprechfluss sichtbar machen & trainieren', 60, 755)

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
    const trimmed = url.trim()
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
      setFetchedMediaInfo(null)
      setIsFetchingMediaInfo(false)
      return
    }

    let isCancelled = false
    setIsFetchingMediaInfo(true)

    const isYouTube = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/i.test(trimmed)

    const fetchInfo = async () => {
      let resolvedTitle = ''
      let resolvedUploader = ''

      // 1. Fast direct client-side oEmbed for YouTube (instant 50ms)
      if (isYouTube) {
        try {
          const oeRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(trimmed)}&format=json`)
          if (oeRes.ok) {
            const oeData = await oeRes.json()
            if (oeData?.title) {
              resolvedTitle = oeData.title
              resolvedUploader = oeData.author_name || ''
              if (!isCancelled) {
                setFetchedMediaInfo({
                  title: resolvedTitle,
                  uploader: resolvedUploader,
                  duration: 0,
                })
                setAnalysisTitle((prev) => prev ? prev : resolvedTitle)
              }
            }
          }
        } catch (oeErr) {
          console.warn('oEmbed client fetch note:', oeErr)
        }
      }

      // 2. Fetch duration and backend fallback metadata
      try {
        const res = await fetch('/api/media-info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: trimmed }),
        })
        if (res.ok && !isCancelled) {
          const data = await res.json()
          const finalTitle = data.title || resolvedTitle
          const finalUploader = data.uploader || resolvedUploader
          const finalDuration = Number(data.duration || 0)

          if (finalTitle || finalDuration > 0) {
            setFetchedMediaInfo({
              title: finalTitle || 'YouTube Video',
              duration: finalDuration,
              uploader: finalUploader,
            })
            if (finalTitle) {
              setAnalysisTitle((prev) => prev ? prev : finalTitle)
            }
          }
        }
      } catch (srvErr) {
        console.warn('Server media-info fetch note:', srvErr)
      } finally {
        if (!isCancelled) setIsFetchingMediaInfo(false)
      }
    }

    const timer = setTimeout(fetchInfo, 150)

    return () => {
      isCancelled = true
      clearTimeout(timer)
    }
  }, [url])

  useEffect(() => {
    if (fetchedMediaInfo?.duration && fetchedMediaInfo.duration > 0) {
      const estimate = getEstimatedAnalysisSeconds(fetchedMediaInfo.duration)
      setProgress((current) => ({ ...current, remainingSeconds: estimate }))
      return
    }

    if (!file && !url) {
      return
    }

    if (file) {
      const source = URL.createObjectURL(file)
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
        URL.revokeObjectURL(source)
      }
    }
  }, [file, url, fetchedMediaInfo?.duration])

  const activeHistoryEntry = useMemo(
    () => (activeHistoryId ? history.find((entry) => entry.id === activeHistoryId) : null),
    [history, activeHistoryId]
  )
  const currentMediaTitle = useMemo(() => {
    if (activeHistoryEntry?.title) return activeHistoryEntry.title
    if (activeHistoryEntry?.sourceLabel) return activeHistoryEntry.sourceLabel
    if (analysisTitle) return analysisTitle
    if (result?.mediaTitle) return result.mediaTitle
    if (fetchedMediaInfo?.title) return fetchedMediaInfo.title
    if (file?.name) return file.name
    if (url) {
      const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/)
      if (match) return `YouTube (${match[1]})`
      return url
    }
    return ''
  }, [activeHistoryEntry, analysisTitle, result, fetchedMediaInfo, file, url])

  const activeSourceLabel = currentMediaTitle || 'Unbekannte Quelle'

  // Dynamic Browser Tab Title to clearly distinguish multiple instances/tabs
  useEffect(() => {
    if (isAnalyzing) {
      document.title = currentMediaTitle
        ? `(${Math.round(progress.percent)}%) ${currentMediaTitle} — ähm-zähler`
        : `(${Math.round(progress.percent)}%) Analyse läuft — ähm-zähler`
    } else if (result && currentMediaTitle) {
      document.title = `✓ ${currentMediaTitle} — ähm-zähler`
    } else {
      document.title = 'ähm-zähler — Füllwörter sichtbar machen'
    }
  }, [isAnalyzing, progress.percent, result, currentMediaTitle])

  // Matomo SPA Page View Tracking (tracked on tab/view switch)
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any)._paq) {
      const pageUrl = window.location.pathname + (view === 'analyse' ? '' : `#${view}`)
      const paq = (window as any)._paq
      paq.push(['setCustomUrl', pageUrl])
      paq.push(['setDocumentTitle', document.title || 'ähm-zähler'])
      paq.push(['trackPageView'])
    }
  }, [view])

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
    const initialDuration = fetchedMediaInfo?.duration || 0
    const initialRemaining = initialDuration > 0 ? getEstimatedAnalysisSeconds(initialDuration) : defaultEstimatedAnalysisSeconds

    setProgress({
      percent: 5,
      step: 0,
      label: url ? 'Lade Video von YouTube...' : 'Audiodatei wird vorbereitet...',
      remainingSeconds: initialRemaining,
    })

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
        const totalDuration = Number(data.duration || fetchedMediaInfo?.duration || 0)
        let remainingSeconds: number | null = null
        if (totalDuration > 0 && data.currentTime && data.currentTime > 0) {
          const remainingAudio = Math.max(0, totalDuration - Number(data.currentTime))
          remainingSeconds = Math.max(1, Math.round(remainingAudio * 0.35))
        } else if (totalDuration > 0) {
          remainingSeconds = getEstimatedAnalysisSeconds(totalDuration)
        }

        setProgress((prev) => ({
          percent: data.percent || prev.percent,
          step: 2,
          label: `Whisper KI analysiert... (${Math.round(data.currentTime || 0)}s / ${Math.round(totalDuration || data.duration || 0)}s)`,
          remainingSeconds: remainingSeconds !== null ? remainingSeconds : prev.remainingSeconds,
        }))
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

            if (event.type === 'queue') {
              setQueueInfo({ position: event.queuePosition, total: event.queueLength || event.queuePosition, message: event.message })
            } else if (event.type === 'status') {
              setQueueInfo(null)
              handleProgressUpdate(event)
            } else if (event.type === 'progress') {
              setQueueInfo(null)
              handleProgressUpdate(event)
            } else if (event.type === 'complete') {
              setQueueInfo(null)
              handleProgressUpdate(event)
            } else if (event.type === 'error') {
              setQueueInfo(null)
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
        setQueueInfo(null)
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
          setQueueInfo(null)
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
    setQueueInfo(null)
    setProgress({ percent: 0, step: 0, label: 'Analyse abgebrochen', remainingSeconds: null })
  }

  return (
    <main>
      <nav className="topbar">
        <button className="brand" onClick={() => setView('analyse')} type="button">
          <img className="brand-logo-img" src="/logo.png" alt="ähm-zähler Logo" />
          <span className="brand-title">ähm-zähler</span>
        </button>
        <div className="nav-actions">
          <button className={view === 'analyse' ? 'nav-link active' : 'nav-link'} onClick={() => setView('analyse')} type="button">Analyse</button>
          <button className={view === 'live' ? 'nav-link active' : 'nav-link'} onClick={() => setView('live')} type="button">🔴 Live Studio</button>
          <button className={view === 'settings' ? 'nav-link active' : 'nav-link'} onClick={() => setView('settings')} type="button">Settings</button>
          <button
            type="button"
            className="self-host-badge-btn"
            onClick={() => setShowSelfHostModal(true)}
            title="Auf eigenem Server oder Raspberry Pi 5 hosten"
          >
            🍓 Self-Host
          </button>
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
                  {isFetchingMediaInfo && (
                    <div className="url-preview-card loading">
                      <div className="url-preview-spinner" />
                      <span>Ermittle YouTube-Titel & Videolänge…</span>
                    </div>
                  )}
                  {fetchedMediaInfo && !isFetchingMediaInfo && (
                    <div className="url-preview-card">
                      <span className="url-preview-badge-icon">🎬</span>
                      <div className="url-preview-meta">
                        <strong className="url-preview-title">{fetchedMediaInfo.title}</strong>
                        <span className="url-preview-sub">
                          {fetchedMediaInfo.uploader ? `${fetchedMediaInfo.uploader} • ` : ''}
                          {formatTimestamp(fetchedMediaInfo.duration)} Min.
                        </span>
                      </div>
                    </div>
                  )}
                  <small>YouTube, Vimeo oder direkte Medienlinks werden unterstützt.</small>
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

              {queueInfo && isAnalyzing && (
                <div className="queue-callout-card" onClick={() => setShowSelfHostModal(true)} title="Klicken für Self-Hosting Infos (Raspberry Pi 5 / GitHub)">
                  <div className="queue-callout-header">
                    <div className="queue-spinner" />
                    <strong>Warteschlange: Position #{queueInfo.position} von {queueInfo.total}</strong>
                  </div>
                  <p className="queue-callout-copy">
                    Der Server verarbeitet gerade eine andere Analyse. Dein Auftrag startet gleich automatisch.
                  </p>
                  <div className="queue-callout-action">
                    <span>🍓 Keine Wartezeit: Auf eigenem Server oder Raspberry Pi 5 hosten</span>
                    <span className="action-arrow">→</span>
                  </div>
                </div>
              )}

              {isAnalyzing && !queueInfo && (
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
                          className="report-btn report-btn-comment"
                          onClick={copyFeedbackComment}
                          title="Freundliches Feedback mit Einleitung als YouTube-Kommentar kopieren"
                        >
                          {copyStatus === 'copied-comment' ? '✓ Kommentar kopiert!' : '💬 YouTube-Kommentar kopieren'}
                        </button>
                        <button
                          type="button"
                          className="report-btn report-btn-copy"
                          onClick={copyTextSummary}
                          title="Kurze Statistik-Zusammenfassung kopieren (für E-Mail, Notizen etc.)"
                        >
                          {copyStatus === 'copied' ? '✓ Bericht kopiert!' : '📋 Kurzbericht kopieren'}
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
                            let bg = "hsl(140, 30%, 86%)"
                            if (bucket.count > 0) {
                              const hue = Math.round(52 - intensity * 52)
                              const sat = Math.round(85 + intensity * 15)
                              const light = Math.round(48 - intensity * 10)
                              bg = `hsl(${hue}, ${sat}%, ${light}%)`
                            }
                            return (
                              <div
                                key={i}
                                className="heatmap-cell"
                                style={{ background: bg }}
                                title={`${formatTimestamp(bucket.t0)} — ${bucket.count} Füllwort${bucket.count !== 1 ? 'er' : ''} (Klicken zum Anhören)`}
                                onClick={() => seekAndPlay(bucket.t0)}
                              />
                            )
                          })}
                        </div>
                        <div className="heatmap-legend">
                          <span><span className="heatmap-legend-dot" style={{ background: 'hsl(140, 30%, 86%)', border: '1px solid #94a3b8' }} />Kein Füllwort</span>
                          <span><span className="heatmap-legend-dot" style={{ background: 'hsl(45, 90%, 50%)' }} />Wenige</span>
                          <span><span className="heatmap-legend-dot" style={{ background: 'hsl(0, 85%, 45%)' }} />Viele</span>
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

          <AppFooter />
        </>
      )}
      {view === 'settings' && <AppFooter />}

      {/* Self-Host & Queue Modal */}
      {(queueInfo || showSelfHostModal) && (
        <div className="self-host-modal-overlay" onClick={() => setShowSelfHostModal(false)}>
          <div className="self-host-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-badge-pill">🍓 Raspberry Pi 5 & Self-Hosting</span>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => {
                  setShowSelfHostModal(false)
                }}
              >✕</button>
            </div>

            {queueInfo && (
              <div className="queue-live-banner">
                <div className="queue-spinner" />
                <div className="queue-banner-text">
                  <strong>Server ausgelastet — Du bist in der Warteschlange!</strong>
                  <span>Position #{queueInfo.position} von {queueInfo.total}. Deine Analyse startet automatisch, sobald der vorherige Auftrag fertig ist.</span>
                </div>
              </div>
            )}

            <h3>Keine Lust zu warten? Hoste „ähm-zähler“ selbst!</h3>
            <p className="modal-intro">
              Du kannst diesen Füllwort-Zähler komplett eigenständig und kostenlos auf deiner eigenen Hardware betreiben — perfekt für einen <strong>Raspberry Pi 5</strong> oder einen eigenen Server!
            </p>

            <div className="self-host-features-grid">
              <div className="feature-item">
                <span className="feat-icon">🍓</span>
                <div>
                  <strong>Optimiert für Raspberry Pi 5</strong>
                  <p>Dank ARM64-Unterstützung und quantisiertem <code>faster-whisper (int8)</code> läuft die KI auf dem Pi 5 extrem schnell, leise & stromsparend.</p>
                </div>
              </div>
              <div className="feature-item">
                <span className="feat-icon">🔒</span>
                <div>
                  <strong>100% Privatsphäre & keine Limits</strong>
                  <p>Keine Warteschlange, unbegrenzte Dateigrößen und kein Upload auf fremde Server. Deine Daten bleiben bei dir.</p>
                </div>
              </div>
              <div className="feature-item">
                <span className="feat-icon">🚀</span>
                <div>
                  <strong>In 2 Minuten eingerichtet</strong>
                  <p>Einfach das GitHub-Repo klonen und mit Python / Docker oder systemd starten.</p>
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <a
                href="https://github.com/Schello805/aehm-zaehler"
                target="_blank"
                rel="noopener noreferrer"
                className="modal-github-button"
              >
                <svg className="footer-github-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                </svg>
                <span>GitHub Anleitung & Repo öffnen →</span>
              </a>
              <button
                type="button"
                className="modal-dismiss-btn"
                onClick={() => setShowSelfHostModal(false)}
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function AppFooter() {
  return (
    <footer>
      <div className="footer-left">
        <span>ähm-zähler / 2026</span>
        <span className="footer-divider">•</span>
        <span className="footer-author">Erstellt durch Michael Schellenberger (VibeCoder)</span>
      </div>
      <div className="footer-right">
        <a
          href="https://github.com/Schello805/aehm-zaehler"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-github-link"
          title="GitHub Projekt anzeigen"
        >
          <svg className="footer-github-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
          </svg>
          <span>GitHub</span>
        </a>
      </div>
    </footer>
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
  "äh": [["äh", "ä", "ah", "aeh", "eh", "öh", "oeh", "ähh", "ähhh", "ää", "äääh", "uh", "er", "a"]],
  "ähm": [["ähm", "m", "em", "mm", "mmm", "hm", "hmm", "hmmm", "ahm", "am", "öhm", "oehm", "uhm", "erm", "äm", "aem", "äähm", "äh", "aehm", "ehm"]],
  "also äh": [["also"], ["äh", "ä", "ah", "aeh", "eh", "öh", "oeh", "ähh", "ähhh", "ää", "uh", "er", "a"]],
  "also ähm": [["also"], ["ähm", "m", "em", "mm", "mmm", "hm", "hmm", "hmmm", "ahm", "am", "öhm", "uhm", "erm", "äm", "äähm"]],
  "aber äh": [["aber"], ["äh", "ä", "ah", "aeh", "eh", "öh", "oeh", "ähh", "ähhh", "ää", "uh", "er", "a"]],
  "aber ähm": [["aber"], ["ähm", "m", "em", "mm", "mmm", "hm", "hmm", "hmmm", "ahm", "am", "öhm", "uhm", "erm", "äm", "äähm"]],
  "und äh": [["und"], ["äh", "ä", "ah", "aeh", "eh", "öh", "oeh", "ähh", "ähhh", "ää", "uh", "er", "a"]],
  "und ähm": [["und"], ["ähm", "m", "em", "mm", "mmm", "hm", "hmm", "hmmm", "ahm", "am", "öhm", "uhm", "erm", "äm", "äähm"]],
  "sozusagen": [["sozusagen", "sozusagn"]],
  "eigentlich": [["eigentlich"]],
  "quasi": [["quasi"]],
  "praktisch": [["praktisch"]],
  "halt": [["halt"]],
  "irgendwie": [["irgendwie"]],
  "im grunde": [["im", "in"], ["grunde", "grund"]],
  "im endeffekt": [["im", "in"], ["endeffekt"]]
};

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
  const isListeningRef = useRef(false)
  const [liveCount, setLiveCount] = useState(0)
  const [wordCounts, setWordCounts] = useState<Record<string, number>>({})
  const [liveTranscript, setLiveTranscript] = useState<string>("")
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
  const elapsedSecondsRef = useRef(0)
  
  // Persistent tracking across SpeechRecognition pauses/restarts
  const sessionCountRef = useRef(0)
  const accumulatedFinalTextRef = useRef<string>("")
  const segmentFillersRef = useRef<Map<string, Record<string, number>>>(new Map())

  // Auto-scroll transcript box to bottom on new content
  useEffect(() => {
    const box = transcriptBoxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [liveTranscript])

  // Track whether counter popped this cycle
  const popCounterAnimation = () => {
    const el = counterRef.current
    if (!el) return
    el.classList.remove("counter-pop")
    void el.offsetWidth // reflow to restart
    el.classList.add("counter-pop")
  }

  // Spawn particles on filler word detection
  const spawnParticles = () => {
    const canvas = particleCanvasRef.current
    if (!canvas) return
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    const colors = ["#f37d21", "#ef4444", "#ffb800", "#ff6b6b", "#fbbf24"]
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 2 + Math.random() * 4
      particlesRef.current.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        alpha: 1,
        color: colors[Math.floor(Math.random() * colors.length)]
      })
    }
    if (!particleAnimRef.current) {
      animateParticles()
    }
  }

  const animateParticles = () => {
    const canvas = particleCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    particlesRef.current = particlesRef.current.filter((p) => p.alpha > 0.04)

    for (const p of particlesRef.current) {
      p.x += p.vx
      p.y += p.vy
      p.vy += 0.12 // gravity
      p.alpha *= 0.94
      ctx.save()
      ctx.globalAlpha = p.alpha
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    if (particlesRef.current.length > 0) {
      particleAnimRef.current = requestAnimationFrame(animateParticles)
    } else {
      particleAnimRef.current = null
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }

  // Draw Rolling WPM Canvas
  useEffect(() => {
    const canvas = wpmCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    // Background grid lines
    ctx.fillStyle = "rgba(0, 0, 0, 0.02)"
    ctx.fillRect(0, 0, w, h)

    const maxWpm = 220
    const getY = (val: number) => h - Math.max(0, Math.min(h - 8, (val / maxWpm) * (h - 16) + 8))

    // 120 WPM green line
    ctx.strokeStyle = "rgba(34, 197, 94, 0.25)"
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    const y120 = getY(120)
    ctx.moveTo(0, y120)
    ctx.lineTo(w, y120)
    ctx.stroke()

    // 180 WPM red line
    ctx.strokeStyle = "rgba(239, 68, 68, 0.25)"
    ctx.beginPath()
    const y180 = getY(180)
    ctx.moveTo(0, y180)
    ctx.lineTo(w, y180)
    ctx.stroke()
    ctx.setLineDash([])

    // Zone labels
    ctx.font = "8px SFMono-Regular, Consolas, monospace"
    ctx.fillStyle = "rgba(34, 197, 94, 0.6)"
    ctx.fillText("120 WPM", 4, y120 - 2)
    ctx.fillStyle = "rgba(239, 68, 68, 0.6)"
    ctx.fillText("180 WPM", 4, y180 - 2)

    if (wpmHistory.length < 2) return

    ctx.beginPath()
    const step = w / Math.max(1, wpmHistory.length - 1)
    wpmHistory.forEach((val, i) => {
      const x = i * step
      const y = getY(val)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })

    const gradient = ctx.createLinearGradient(0, 0, 0, h)
    const latestWpm = wpmHistory[wpmHistory.length - 1] || 0
    if (latestWpm > 180) {
      gradient.addColorStop(0, "rgba(239, 68, 68, 0.35)")
      gradient.addColorStop(1, "rgba(239, 68, 68, 0.0)")
      ctx.strokeStyle = "#ef4444"
    } else if (latestWpm >= 110 && latestWpm <= 165) {
      gradient.addColorStop(0, "rgba(34, 197, 94, 0.35)")
      gradient.addColorStop(1, "rgba(34, 197, 94, 0.0)")
      ctx.strokeStyle = "#22c55e"
    } else {
      gradient.addColorStop(0, "rgba(243, 125, 33, 0.35)")
      gradient.addColorStop(1, "rgba(243, 125, 33, 0.0)")
      ctx.strokeStyle = "#f37d21"
    }
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.lineTo((wpmHistory.length - 1) * step, h)
    ctx.lineTo(0, h)
    ctx.closePath()
    ctx.fillStyle = gradient
    ctx.fill()
  }, [wpmHistory])

  // Timer
  useEffect(() => {
    if (isListening) {
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((prev) => {
          const next = prev + 1
          elapsedSecondsRef.current = next
          return next
        })
      }, 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = null
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isListening])

  // Ambient alert flash
  useEffect(() => {
    if (lastAlert) {
      setIsAmbientAlert(true)
      const t = setTimeout(() => setIsAmbientAlert(false), 2000)
      return () => clearTimeout(t)
    }
  }, [lastAlert])

  const startVisualizer = (stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioCtx) return
      const audioCtx = new AudioCtx()
      audioContextRef.current = audioCtx
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 64
      analyser.smoothingTimeConstant = 0.8

      const source = audioCtx.createMediaStreamSource(stream)
      source.connect(analyser)

      const bufferLength = analyser.frequencyBinCount
      const freqData = new Uint8Array(bufferLength)
      const timeData = new Uint8Array(bufferLength)

      const draw = () => {
        animFrameRef.current = requestAnimationFrame(draw)
        analyser.getByteFrequencyData(freqData)
        analyser.getByteTimeDomainData(timeData)

        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext("2d")
        if (!ctx) return

        ctx.clearRect(0, 0, canvas.width, canvas.height)

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

        ctx.lineWidth = 2
        const isSpeaking = maxVol > 25
        ctx.strokeStyle = isSpeaking ? "#00e676" : "#ff9800"
        ctx.shadowColor = isSpeaking ? "#00e676" : "rgba(255, 152, 0, 0.4)"
        ctx.shadowBlur = isSpeaking ? 8 : 3
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
      console.error("Audio visualizer error:", err)
    }
  }

  const stopVisualizer = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    if (audioContextRef.current) void audioContextRef.current.close()
    audioContextRef.current = null
    animFrameRef.current = null
  }

  const startListening = async () => {
    console.log("[LiveStudio] startListening() called")
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert("Dein Browser unterstützt keine Echtzeit-Spracherkennung. Bitte nutze Google Chrome oder MS Edge für das Live Studio.")
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      void startVisualizer(stream)

      let currentSessionFinalText = ""

      const recognition = new SpeechRecognition()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = "de-DE"
      recognition.maxAlternatives = 3

      recognition.onresult = (event: any) => {
        let sessFinal = ""
        let sessInterim = ""
        const sessId = sessionCountRef.current

        for (let i = 0; i < event.results.length; i++) {
          const res = event.results[i]
          const isFinal = res.isFinal
          const primaryTranscript = res[0]?.transcript || ""

          if (isFinal) {
            sessFinal += (sessFinal ? " " : "") + primaryTranscript.trim()
          } else {
            sessInterim += (sessInterim ? " " : "") + primaryTranscript.trim()
          }

          // All alternatives of this segment
          const allAlts: string[] = []
          for (let alt = 0; alt < res.length; alt++) {
            const altText = res[alt]?.transcript
            if (altText) allAlts.push(altText)
          }
          if (allAlts.length === 0 && primaryTranscript) {
            allAlts.push(primaryTranscript)
          }

          // Lock in maximum occurrence for each search word in this segment
          const segKey = `${sessId}_${i}`
          const segExisting = segmentFillersRef.current.get(segKey) || {}
          const segUpdated: Record<string, number> = { ...segExisting }

          for (const w of words) {
            const bestForThisAltScan = Math.max(
              0,
              ...allAlts.map((text) => {
                const toks = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []
                return countTargetInTokens(toks, w)
              })
            )
            segUpdated[w] = Math.max(segExisting[w] || 0, bestForThisAltScan)
          }

          segmentFillersRef.current.set(segKey, segUpdated)
        }

        currentSessionFinalText = sessFinal

        // Combined transcript across all sessions & current interim
        const fullTranscript = (
          (accumulatedFinalTextRef.current ? accumulatedFinalTextRef.current + " " : "") +
          sessFinal +
          (sessInterim ? " " + sessInterim : "")
        ).trim()

        // Combine total counts across all stored segments of all sessions
        const totalCounts: Record<string, number> = {}
        for (const w of words) totalCounts[w] = 0
        segmentFillersRef.current.forEach((segCounts) => {
          for (const w of words) {
            totalCounts[w] += (segCounts[w] || 0)
          }
        })

        const totalFiller = Object.values(totalCounts).reduce((a, b) => a + b, 0)

        setLiveTranscript(fullTranscript)
        setWordCounts(totalCounts)

        // Trigger animations & alerts when count increases
        setLiveCount((prev) => {
          if (totalFiller > prev) {
            popCounterAnimation()
            spawnParticles()
          }
          return totalFiller
        })

        // WPM calculation
        const secs = elapsedSecondsRef.current
        const totalTokens = fullTranscript.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []
        if (totalTokens.length > 0 && secs > 0) {
          const wpm = Math.round((totalTokens.length / secs) * 60)
          setSpeechPace(wpm)
          setWpmHistory((prev) => {
            const next = [...prev, wpm]
            return next.length > 60 ? next.slice(-60) : next
          })
        }

        const lastWordMatched = words.find((w) => (totalCounts[w] || 0) > (wordCounts[w] || 0))
        if (lastWordMatched) {
          setLastAlert(`Füllwort erkannt: „${lastWordMatched}"! Kurz innehalten & Stimme absenken.`)
        }
      }

      recognition.onstart = () => {
        console.log("[LiveStudio] recognition.onstart — running")
      }

      recognition.onerror = (err: any) => {
        console.error("[LiveStudio] recognition.onerror:", err.error, err.message)
        if (err.error === "not-allowed") {
          setLastAlert("Mikrofon-Zugriff verweigert. Bitte erlaube den Zugriff in den Browser-Einstellungen.")
        } else if (err.error === "network") {
          setLastAlert("Netzwerkfehler: Spracherkennung benötigt eine Internetverbindung.")
        } else if (err.error !== "no-speech" && err.error !== "aborted") {
          setLastAlert(`Erkennungsfehler: ${err.error}`)
        }
      }

      recognition.onend = () => {
        console.log("[LiveStudio] recognition.onend — restarting:", isListeningRef.current)
        if (currentSessionFinalText) {
          accumulatedFinalTextRef.current = (
            (accumulatedFinalTextRef.current ? accumulatedFinalTextRef.current + " " : "") +
            currentSessionFinalText
          ).trim()
        }
        sessionCountRef.current += 1
        if (isListeningRef.current) {
          try {
            recognition.start()
          } catch (restartErr) {
            console.warn("[LiveStudio] Restart failed:", restartErr)
          }
        }
      }

      recognition.start()
      recognitionRef.current = recognition
      isListeningRef.current = true
      setIsListening(true)
      setLastAlert("Live-Erkennung aktiv. Sprich frei ins Mikrofon!")
    } catch (e) {
      console.error("[LiveStudio] startListening CATCH:", e)
      const msg = e instanceof Error ? e.message : String(e)
      setLastAlert(`Fehler beim Starten: ${msg}`)
    }
  }

  const stopListening = () => {
    isListeningRef.current = false
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    stopVisualizer()
    setIsListening(false)
  }

  const resetLiveSession = () => {
    stopListening()
    setLiveCount(0)
    setWordCounts({})
    setLiveTranscript("")
    setLastAlert(null)
    setElapsedSeconds(0)
    setSpeechPace(0)
    setWpmHistory([])
    setIsAmbientAlert(false)
    sessionCountRef.current = 0
    accumulatedFinalTextRef.current = ""
    segmentFillersRef.current.clear()
    particlesRef.current = []
    const ctx = particleCanvasRef.current?.getContext("2d")
    if (ctx && particleCanvasRef.current) ctx.clearRect(0, 0, particleCanvasRef.current.width, particleCanvasRef.current.height)
  }

  return (
    <section className="live-studio-view">
      <div className="live-studio-header">
        <div className="live-studio-header-titles">
          <span className="eyebrow">ECHTZEIT-SPRECHFLUSS-TRAINER</span>
          <h1>🔴 Live Studio — <em>Präsentation live üben</em></h1>
          <p className="intro-copy">Sprich frei ins Mikrofon. Füllwörter werden live gezählt, Wave & Tempo getracked.</p>
        </div>
        <div className="live-header-status-badge">
          <span className={isListening ? "live-mic-dot recording" : "live-mic-dot"} />
          <b>{isListening ? "LIVE-ERKENNUNG AKTIV" : "BEREIT"}</b>
        </div>
      </div>

      <div className="live-studio-grid">
        <div className="live-studio-panel left-panel">
          <div className={`live-counter-box${isAmbientAlert ? " ambient-alert" : ""}`}>
            <img src="/logo.png" alt="ähm-zähler Logo" className="live-logo-badge" />

            {/* Particle canvas overlay */}
            <div className="particle-canvas-wrap">
              <div className="flip-counter-display">
                <span ref={counterRef} className="flip-counter-number">{String(liveCount).padStart(2, "0")}</span>
              </div>
              <canvas ref={particleCanvasRef} width={180} height={90} className="particle-canvas" />
            </div>

            <div className="audio-visualizer-box" title="Echtzeit-Audio-Waveform deines Mikrofons">
              <div className="wave-label"><span>WAVE-SIGNAL</span></div>
              <canvas ref={canvasRef} width={260} height={42} className="audio-visualizer-canvas" />
            </div>

            <div className="live-status-indicator">
              <span className={isListening ? "live-mic-dot recording" : "live-mic-dot"} />
              <span>{isListening ? "Mikrofon aktiv" : "Standby"}</span>
            </div>
          </div>

          <div className="live-controls">
            {!isListening ? (
              <button type="button" className="live-start-button" onClick={startListening}>
                <span>🎙️ Starten</span>
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
              <strong>{speechPace} <span style={{ fontSize: "12px", fontWeight: 400 }}>WPM</span></strong>
            </div>
          </div>

          {/* WPM Rolling Chart */}
          <div className="wpm-chart-box">
            <div className="wpm-chart-label">📈 Sprechtempo-Verlauf (letzte 60 Sek.)</div>
            <canvas ref={wpmCanvasRef} width={460} height={55} className="wpm-chart-canvas" />
            {wpmHistory.length < 2 && (
              <div className="wpm-chart-hint">Sprich ins Mikrofon — der Tempo-Graph erscheint in Echtzeit</div>
            )}
          </div>

          {/* Live Transcript Stream */}
          <div className="live-transcript-box" ref={transcriptBoxRef}>
            <div className="live-transcript-header">
              <span className="live-transcript-title">🎙️ Live Transkript</span>
              <span className="live-transcript-wordcount">
                {liveTranscript ? `${(liveTranscript.match(/[\p{L}\p{N}]+/gu) || []).length} Wörter` : "Warten auf Sprache..."}
              </span>
            </div>
            <p className="transcript-text">
              {liveTranscript || (
                <span className="transcript-placeholder">
                  {isListening ? "🎙️ Spracherkennung lauscht... Sprich frei drauflos!" : "Klicke links auf „Starten“ und sprich ins Mikrofon."}
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
  )
}

export default App
