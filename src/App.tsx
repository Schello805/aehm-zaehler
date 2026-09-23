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

type SpeakerStats = {
  id: string
  name: string
  gender?: 'm' | 'w' | 'unknown'
  totalWords: number
  fillerWords: number
  baseFillerWords: number
  relativeRate: number
  duration: number
  wpm: number
  counts: Record<string, number>
  color: string
}

type TranscriptSegment = {
  start: number
  end: number
  text: string
  counts: Record<string, number>
  pitch?: number
  wpm?: number
  speakerId?: string
  speakerName?: string
  speakerGender?: 'm' | 'w' | 'unknown'
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
  speakers?: Record<string, SpeakerStats>
  mediaTitle?: string
  pauseCount?: number
  totalPauseSeconds?: number
}

const ensureMultiSpeakerDiarization = (resultData: Result, wordsList: string[]): Result => {
  if (!resultData || !resultData.segments || resultData.segments.length === 0) return resultData

  // If already has 2+ distinct speakers with actual speech, keep
  if (resultData.speakers && Object.keys(resultData.speakers).length > 1) {
    const populated = Object.values(resultData.speakers).filter((s) => s.totalWords > 0)
    if (populated.length > 1) return resultData
  }

  const rawSegments = resultData.segments
  const validPitches = rawSegments
    .map((s) => Number(s.pitch || 0))
    .filter((p) => p >= 75 && p <= 360)
    .sort((a, b) => a - b)

  let usePitchClustering = false
  let pitchCenter1 = 0
  let pitchCenter2 = 0

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
    }
  }

  const turnMarkers = [
    /^(?:ja|nein|genau|stimmt|absolut|danke|vielen dank|hallo|guten tag|guten morgen|guten abend|servus|moin|auf jeden fall|interessant|frage|was meinst du|wie siehst du|ich glaube|wir haben|übergebe|herzlich willkommen|schönen guten|okay|alles klar|richtig)/i,
    /(?:\?|\!)$/
  ]

  let currentSpeakerIdx = 0
  let isMultiSpeaker = usePitchClustering
  let speakerTurnCount = 0

  const enrichedSegments = rawSegments.map((s, idx) => {
    const segPitch = Number(s.pitch || 0)
    if (usePitchClustering && segPitch >= 75 && segPitch <= 360) {
      const dist1 = Math.abs(segPitch - pitchCenter1)
      const dist2 = Math.abs(segPitch - pitchCenter2)
      const decidedIdx = dist1 <= dist2 ? 0 : 1
      if (decidedIdx !== currentSpeakerIdx) {
        currentSpeakerIdx = decidedIdx
        speakerTurnCount++
      }
    } else if (idx > 0) {
      const prevEnd = Number(rawSegments[idx - 1].end || 0)
      const prevText = String(rawSegments[idx - 1].text || '').trim()
      const segText = String(s.text || '').trim()
      const gap = Number(s.start || 0) - prevEnd

      const prevHasQuestion = prevText.endsWith('?')
      const currentHasTurnCue = turnMarkers[0].test(segText)
      
      if (gap >= 0.9 || (gap >= 0.35 && (prevHasQuestion || currentHasTurnCue))) {
        currentSpeakerIdx = currentSpeakerIdx === 0 ? 1 : 0
        speakerTurnCount++
        isMultiSpeaker = true
      }
    }

    const speakerId = isMultiSpeaker ? `speaker_${currentSpeakerIdx + 1}` : 'speaker_1'
    const speakerName = s.speakerName && s.speakerName !== 'Sprecher 1' ? s.speakerName : (speakerId === 'speaker_1' ? 'Sprecher 1' : 'Sprecher 2')

    return {
      ...s,
      speakerId,
      speakerName,
    }
  })

  if (isMultiSpeaker || speakerTurnCount > 0) {
    const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4']
    const speakers: Record<string, SpeakerStats> = {}
    enrichedSegments.forEach((s) => {
      const spId = s.speakerId || 'speaker_1'
      if (!speakers[spId]) {
        const idx = spId === 'speaker_1' ? 0 : 1
        speakers[spId] = {
          id: spId,
          name: s.speakerName || `Sprecher ${idx + 1}`,
          color: colors[idx % colors.length],
          totalWords: 0,
          fillerWords: 0,
          baseFillerWords: 0,
          relativeRate: 0,
          duration: 0,
          wpm: 0,
          counts: Object.fromEntries(wordsList.map((w) => [w, 0])),
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

    Object.values(speakers).forEach((sp) => {
      sp.fillerWords = Object.values(sp.counts).reduce((a, b) => a + b, 0)
      sp.baseFillerWords = sp.fillerWords
      sp.relativeRate = sp.totalWords > 0 ? (sp.fillerWords / sp.totalWords) * 100 : 0
      sp.wpm = sp.duration > 0 ? Math.round((sp.totalWords / (sp.duration / 60))) : 0
      sp.duration = Math.round(sp.duration * 10) / 10
    })

    return {
      ...resultData,
      segments: enrichedSegments,
      speakers,
    }
  }

  return resultData
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

const getYouTubeVideoId = (srcUrl: string): string | null => {
  if (!srcUrl) return null
  const match = srcUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/)
  return match ? match[1] : null
}

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
  const [speakerFilter, setSpeakerFilter] = useState<string>('all')
  const [editingSpeakerId, setEditingSpeakerId] = useState<string | null>(null)
  const [editingSpeakerName, setEditingSpeakerName] = useState<string>('')

  const renameSpeaker = (speakerId: string, newName: string) => {
    if (!result || !newName.trim()) return
    const trimmed = newName.trim()
    const updatedSpeakers = { ...(result.speakers || {}) }
    if (updatedSpeakers[speakerId]) {
      updatedSpeakers[speakerId] = { ...updatedSpeakers[speakerId], name: trimmed }
    }
    const updatedSegments = (result.segments || []).map((seg) => {
      if (seg.speakerId === speakerId) {
        return { ...seg, speakerName: trimmed }
      }
      return seg
    })
    setResult({
      ...result,
      speakers: updatedSpeakers,
      segments: updatedSegments
    })
    setEditingSpeakerId(null)
  }

  const reassignSegmentSpeaker = (segIndex: number, newSpeakerId: string) => {
    if (!result) return
    const updatedSegments = [...(result.segments || [])]
    const targetSpeaker = result.speakers?.[newSpeakerId]
    if (updatedSegments[segIndex]) {
      updatedSegments[segIndex] = {
        ...updatedSegments[segIndex],
        speakerId: newSpeakerId,
        speakerName: targetSpeaker?.name || newSpeakerId
      }
    }
    const updatedSpeakers = { ...(result.speakers || {}) }
    Object.keys(updatedSpeakers).forEach((k) => {
      updatedSpeakers[k].totalWords = 0
      updatedSpeakers[k].fillerWords = 0
      updatedSpeakers[k].duration = 0
      updatedSpeakers[k].counts = Object.fromEntries(words.map((w) => [w, 0]))
    })
    updatedSegments.forEach((s) => {
      const spId = s.speakerId || 'speaker_1'
      if (!updatedSpeakers[spId]) {
        updatedSpeakers[spId] = {
          id: spId,
          name: s.speakerName || spId,
          color: spId === 'speaker_1' ? '#3b82f6' : '#8b5cf6',
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
      updatedSpeakers[spId].totalWords += wordsInSeg
      updatedSpeakers[spId].duration += Math.max(0, s.end - s.start)
      if (s.counts) {
        Object.entries(s.counts).forEach(([w, c]) => {
          updatedSpeakers[spId].counts[w] = (updatedSpeakers[spId].counts[w] || 0) + Number(c)
        })
      }
    })
    Object.values(updatedSpeakers).forEach((sp) => {
      sp.fillerWords = Object.values(sp.counts).reduce((a, b) => a + b, 0)
      sp.baseFillerWords = sp.fillerWords
      sp.relativeRate = sp.totalWords > 0 ? (sp.fillerWords / sp.totalWords) * 100 : 0
      sp.wpm = sp.duration > 0 ? Math.round((sp.totalWords / (sp.duration / 60))) : 0
    })
    setResult({
      ...result,
      segments: updatedSegments,
      speakers: updatedSpeakers
    })
  }

  const addNewSpeaker = () => {
    if (!result) return
    const currentSpeakers = result.speakers && Object.keys(result.speakers).length > 0
      ? { ...result.speakers }
      : {
          speaker_1: {
            id: 'speaker_1',
            name: 'Sprecher 1',
            color: '#3b82f6',
            totalWords: result.totalWords || 0,
            fillerWords: result.fillerWords || 0,
            baseFillerWords: result.fillerWords || 0,
            relativeRate: result.relativeRate || 0,
            duration: result.duration || 0,
            wpm: 0,
            counts: { ...(result.counts || {}) }
          }
        }
    const count = Object.keys(currentSpeakers).length
    const nextIdx = count + 1
    const newId = `speaker_${nextIdx}`
    const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4']
    const newSpeaker: SpeakerStats = {
      id: newId,
      name: `Sprecher ${nextIdx}`,
      color: colors[(nextIdx - 1) % colors.length],
      totalWords: 0,
      fillerWords: 0,
      baseFillerWords: 0,
      relativeRate: 0,
      duration: 0,
      wpm: 0,
      counts: Object.fromEntries(words.map((w) => [w, 0]))
    }
    setResult({
      ...result,
      speakers: {
        ...currentSpeakers,
        [newId]: newSpeaker
      }
    })
  }

  const fileInputRef = useRef<HTMLInputElement>(null)
  const playbackRef = useRef<HTMLAudioElement>(null)
  const analysisControllerRef = useRef<AbortController | null>(null)
  const currentJobIdRef = useRef<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'copied-comment' | 'copied-link'>('idle')
  const [installPrompt, setInstallPrompt] = useState<any>(null)
  const playbackUrl = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file])

  // Read Deep-Link query params (?v= or ?url=) on mount & listen for PWA install event
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const vParam = params.get('v')
      const urlParam = params.get('url')
      const initial = urlParam || (vParam ? `https://www.youtube.com/watch?v=${vParam}` : '')
      if (initial) {
        setUrl(initial)

        // 1. Check if we already have this in local history
        const initialYt = getYouTubeVideoId(initial)
        const match = history.find((h) => {
          if (h.source === initial) return true
          const hYt = getYouTubeVideoId(h.source)
          return initialYt && hYt && initialYt === hYt
        })

        if (match) {
          const enriched = ensureMultiSpeakerDiarization(match.result, words)
          setResult(enriched)
          setActiveHistoryId(match.id)
          setUrl(match.source)
          setFile(null)
          setView('analyse')
          window.scrollTo({ top: 0, behavior: 'smooth' })
        } else {
          // 2. Automatically launch analysis (server cache will return result in <100ms if available)
          setTimeout(() => {
            analyze(initial)
          }, 150)
        }
      }
    } catch {}

    const handleInstallPrompt = (e: any) => {
      e.preventDefault()
      setInstallPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
  }, [])

  const activeSourceUrl = useMemo(() => {
    if (activeHistoryId) {
      const entry = history.find((h) => h.id === activeHistoryId)
      return entry?.source || url || ''
    }
    return url || ''
  }, [activeHistoryId, history, url])

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
    let attempts = 0

    const tryConnect = () => {
      if (!isMounted) return false
      const el = document.getElementById('youtube-sync-iframe')
      if (el && window.YT && window.YT.Player) {
        try {
          playerInstance = new window.YT.Player('youtube-sync-iframe', {
            events: {
              onReady: (event: any) => {
                if (isMounted) setYtPlayer(event.target)
              },
              onStateChange: (event: any) => {
                if (event?.target && isMounted) {
                  setYtPlayer(event.target)
                }
              },
            },
          })
          return true
        } catch (err) {
          console.warn('YouTube Player Connect Attempt:', err)
        }
      }
      return false
    }

    const interval = setInterval(() => {
      attempts++
      if (tryConnect() || attempts > 30) {
        clearInterval(interval)
      }
    }, 200)

    if (window.YT && window.YT.Player) {
      tryConnect()
    } else {
      window.onYouTubeIframeAPIReady = () => {
        tryConnect()
      }
    }

    return () => {
      isMounted = false
      clearInterval(interval)
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

  const pauseSegments = useMemo(() => {
    if (!result?.segments || result.segments.length < 2) return []
    const pauses: Array<{ id: string; start: number; end: number; duration: number }> = []
    const segs = result.segments
    if (segs[0].start >= 1.8) {
      pauses.push({
        id: 'pause-0',
        start: 0,
        end: segs[0].start,
        duration: segs[0].start,
      })
    }
    for (let i = 0; i < segs.length - 1; i++) {
      const gap = segs[i + 1].start - segs[i].end
      if (gap >= 1.8) {
        pauses.push({
          id: `pause-${i + 1}`,
          start: segs[i].end,
          end: segs[i + 1].start,
          duration: gap,
        })
      }
    }
    return pauses
  }, [result])

  const currentFillerIndex = useMemo(() => {
    if (!fillerSegments.length) return -1
    const idx = fillerSegments.findIndex((seg) => activePlayTime >= seg.start - 0.25 && activePlayTime <= seg.end + 0.3)
    if (idx !== -1) return idx
    const prevs = fillerSegments.filter((seg) => seg.start <= activePlayTime)
    return prevs.length ? prevs.length - 1 : 0
  }, [fillerSegments, activePlayTime])

  const currentPauseIndex = useMemo(() => {
    if (!pauseSegments.length) return -1
    const idx = pauseSegments.findIndex((p) => activePlayTime >= p.start - 0.25 && activePlayTime <= p.end + 0.25)
    if (idx !== -1) return idx
    const prevs = pauseSegments.filter((p) => p.start <= activePlayTime)
    return prevs.length ? prevs.length - 1 : 0
  }, [pauseSegments, activePlayTime])

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

  const jumpToPause = (direction: 'next' | 'prev') => {
    if (!pauseSegments.length) return
    let currentTime = activePlayTime
    if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
      try { currentTime = ytPlayer.getCurrentTime() || activePlayTime } catch {}
    } else if (playbackRef.current) {
      currentTime = playbackRef.current.currentTime || activePlayTime
    }

    if (direction === 'next') {
      const nextIndex = pauseSegments.findIndex((p) => p.start > currentTime + 0.3)
      const idx = nextIndex !== -1 ? nextIndex : 0
      seekAndPlay(Math.max(0, pauseSegments[idx].start))
    } else {
      const prevPauses = pauseSegments.filter((p) => p.start < currentTime - 0.5)
      const idx = prevPauses.length ? pauseSegments.indexOf(prevPauses[prevPauses.length - 1]) : pauseSegments.length - 1
      seekAndPlay(Math.max(0, pauseSegments[idx].start))
    }
  }

  // Live time tracking for YouTube Player
  useEffect(() => {
    if (!activeYoutubeId && !playbackRef.current) return
    const timer = setInterval(() => {
      if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
        try {
          const t = ytPlayer.getCurrentTime()
          if (typeof t === 'number' && !isNaN(t)) {
            setActivePlayTime(t)
          }
        } catch {}
      }
    }, 250)
    return () => clearInterval(timer)
  }, [activeYoutubeId, ytPlayer])

  // Global Keyboard Navigation for Sniper
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }

      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        jumpToFiller('next')
      } else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        jumpToFiller('prev')
      } else if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault()
        jumpToPause('next')
      } else if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault()
        jumpToPause('prev')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [fillerSegments, pauseSegments, activePlayTime, ytPlayer])

  useEffect(() => {
    if (!isSupercutActive || !fillerSegments.length) return

    let currentIndex = 0
    let snippetTimer: any = null
    let pollTimer: any = null
    let isAdvancing = false

    const playSnippet = (index: number) => {
      if (index >= fillerSegments.length) {
        setIsSupercutActive(false)
        return
      }

      currentIndex = index
      setSupercutCurrentIndex(index)
      const seg = fillerSegments[index]
      if (!seg) return

      const startTime = Math.max(0, seg.start - 0.15)
      const snippetDuration = Math.min(3.5, Math.max(0.9, (seg.end - seg.start) + 0.35))
      seekAndPlay(startTime)

      if (snippetTimer) clearTimeout(snippetTimer)

      // Fallback timer: guarantees advancement even if playback events lag or are silent
      snippetTimer = setTimeout(() => {
        advanceNext()
      }, snippetDuration * 1000)
    }

    const advanceNext = () => {
      if (isAdvancing) return
      isAdvancing = true
      if (snippetTimer) clearTimeout(snippetTimer)

      const nextIndex = currentIndex + 1
      if (nextIndex < fillerSegments.length) {
        setTimeout(() => {
          isAdvancing = false
          playSnippet(nextIndex)
        }, 60)
      } else {
        setIsSupercutActive(false)
      }
    }

    // Begin playback with the first filler
    playSnippet(0)

    // Watch real-time playback position
    pollTimer = setInterval(() => {
      let currentTime = 0
      if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
        try { currentTime = ytPlayer.getCurrentTime() || 0 } catch {}
      } else if (playbackRef.current) {
        currentTime = playbackRef.current.currentTime || 0
      }

      if (currentTime > 0) {
        setActivePlayTime(currentTime)
        const currentSeg = fillerSegments[currentIndex]
        if (currentSeg && currentTime >= currentSeg.end + 0.25 && !isAdvancing) {
          advanceNext()
        }
      }
    }, 100)

    return () => {
      if (snippetTimer) clearTimeout(snippetTimer)
      if (pollTimer) clearInterval(pollTimer)
    }
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

    let speakerSection = ''
    if (result.speakers && Object.keys(result.speakers).length > 1) {
      speakerSection = '\n\n👥 Auswertung nach Sprechern:\n' + Object.values(result.speakers).map((sp) => {
        const spRatePerMin = sp.duration > 0 ? (sp.fillerWords / (sp.duration / 60)) : 0
        return `• 👤 ${sp.name}: ${sp.fillerWords} Füllwörter (${sp.relativeRate.toFixed(1)} % Quote — ${sp.wpm} WPM, ca. ${spRatePerMin.toFixed(1)}/Min.)`
      }).join('\n')
    }

    const commentText = `Hallo, das Format ist super und ich schätze eure Inhalte und Themen sehr! Ich würde die Videos gerne voll aufsaugen, allerdings lenken mich häufige Füllwörter wie „äh“ und „ähm“ leider stark vom eigentlichen Inhalt ab.

Ich möchte hier rein konstruktives Feedback dalassen, ohne jemanden verletzen oder angreifen zu wollen. Vor einiger Zeit habe ich bei einem Rhetorik-Seminar gelernt, aktiv auf Füllwörter zu achten – seitdem fallen sie mir beim Zuhören leider extrem auf.

Um das Ganze objektiv und greifbar zu machen, habe ich ein Analysetool („ähm-zähler“) gebaut. Hier ist die Auswertung für dieses Video:

⏱️ Dauer: ${formatTimestamp(result.duration)} Min.
🗣️ Wörter gesamt: ${result.totalWords.toLocaleString('de-DE')}
🚨 Füllwörter gesamt: ${result.fillerWords} (${((result.relativeRate || 0) * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} % — ca. ${ratePerMin.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Füllwörter/Min.)${speakerSection}

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

    let speakerSection = ''
    if (result.speakers && Object.keys(result.speakers).length > 1) {
      speakerSection = '\n\n👥 Auswertung nach Sprechern:\n' + Object.values(result.speakers).map((sp) => {
        return `• 👤 ${sp.name}: ${sp.fillerWords} Füllwörter (${sp.relativeRate.toFixed(1)} % Quote — ${sp.wpm} WPM)`
      }).join('\n')
    }

    const summaryText = `📊 Sprechfluss-Analyse: ${activeSourceLabel || 'Audio/Video'}
⏱️ Dauer: ${formatTimestamp(result.duration)} Min.
🗣️ Wörter gesamt: ${result.totalWords.toLocaleString('de-DE')}
🚨 Füllwörter gesamt: ${result.fillerWords} (${((result.relativeRate || 0) * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} % — ${advice.rate.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Füllwörter/Min.)${speakerSection}

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

  const copyShareLink = () => {
    const targetUrl = url || (activeHistoryId ? history.find((h) => h.id === activeHistoryId)?.source : '')
    let shareLink = window.location.href
    if (targetUrl) {
      shareLink = `${window.location.origin}/?url=${encodeURIComponent(targetUrl)}`
    }
    navigator.clipboard.writeText(shareLink).then(() => {
      setCopyStatus('copied-link')
      setTimeout(() => setCopyStatus('idle'), 2500)
    }).catch(() => {})
  }

  const calculatePauses = (segments: TranscriptSegment[]) => {
    if (!segments || segments.length < 2) return { count: 0, totalSeconds: 0 }
    let count = 0
    let totalSeconds = 0
    for (let i = 1; i < segments.length; i++) {
      const gap = segments[i].start - segments[i - 1].end
      if (gap >= 1.2) {
        count += 1
        totalSeconds += gap
      }
    }
    return { count, totalSeconds: Math.round(totalSeconds * 10) / 10 }
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

  const resetToHome = () => {
    setView('analyse')
    setResult(null)
    setActiveHistoryId(null)
    setUrl('')
    setFile(null)
    if (fileInputRef.current) {
      try { fileInputRef.current.value = '' } catch {}
    }
    setAnalysisTitle('')
    setAnalysisNote('')
    setAnalysisTags('')
    setError('')
    setFetchedMediaInfo(null)
    setQueueInfo(null)
    setIsSupercutActive(false)
    setProgress({ percent: 0, step: 0, label: '', remainingSeconds: null })
    try {
      if (window.location.search) {
        window.history.replaceState({}, '', window.location.pathname)
      }
    } catch {}
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const analyze = async (overrideUrl?: string) => {
    const targetUrl = typeof overrideUrl === 'string' ? overrideUrl : url
    if (!file && !targetUrl) return

    const controller = new AbortController()
    analysisControllerRef.current = controller
    setIsAnalyzing(true)
    setError('')
    setResult(null)
    setActiveHistoryId(null)

    if (targetUrl) {
      try {
        const newSearch = `?url=${encodeURIComponent(targetUrl)}`
        if (window.location.search !== newSearch) {
          window.history.replaceState({}, '', `${window.location.pathname}${newSearch}`)
        }
      } catch {}
    }

    const initialDuration = fetchedMediaInfo?.duration || 0
    const initialRemaining = initialDuration > 0 ? getEstimatedAnalysisSeconds(initialDuration) : defaultEstimatedAnalysisSeconds

    setProgress({
      percent: 5,
      step: 0,
      label: targetUrl ? 'Lade Video von YouTube...' : 'Audiodatei wird vorbereitet...',
      remainingSeconds: initialRemaining,
    })

    const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    currentJobIdRef.current = jobId
    console.log('[Analyze] Starting analysis with jobId:', jobId, { file: file?.name, url: targetUrl, words })

    const body = new FormData()
    body.append('jobId', jobId)
    body.append('words', JSON.stringify(words))
    if (file) body.append('file', file)
    if (targetUrl) body.append('url', targetUrl)

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
          speakers: data.speakers,
          mediaTitle: data.mediaTitle,
          pauseCount: data.pauseCount,
          totalPauseSeconds: data.totalPauseSeconds,
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
          speakers: data.speakers,
          mediaTitle: data.mediaTitle,
          pauseCount: data.pauseCount,
          totalPauseSeconds: data.totalPauseSeconds,
        }

        isCompleted = true
        const enriched = ensureMultiSpeakerDiarization(finalResult, words)
        console.log('[Analyze] Complete! Final result:', enriched)
        setResult(enriched)
        setProgress({ percent: 100, step: progressSteps.length - 1, label: 'Ergebnis fertig', remainingSeconds: 0 })

        const fallbackTitle = targetUrl || file?.name || 'Unbekannte Quelle'
        const historyEntry: HistoryEntry = {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          source: fallbackTitle,
          sourceLabel: fallbackTitle,
          createdAt: new Date().toISOString(),
          result: enriched,
          words: [...words],
          title: analysisTitle.trim() || fallbackTitle,
          note: analysisNote.trim(),
          tags: analysisTags.split(',').map((tag) => tag.trim()).filter(Boolean),
        }

        setHistory((current) => [historyEntry, ...current].slice(0, 50))
        setActiveHistoryId(historyEntry.id)
        setIsAnalyzing(false)
        setView('analyse')
        window.scrollTo({ top: 0, behavior: 'smooth' })
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
        <button className="brand" onClick={resetToHome} type="button" title="Zurück zur Startseite">
          <img className="brand-logo-img" src="/logo.png" alt="ähm-zähler Logo" />
          <span className="brand-title">ähm-zähler</span>
        </button>
        <div className="nav-actions">
          <button className={view === 'analyse' ? 'nav-link active' : 'nav-link'} onClick={() => setView('analyse')} type="button">Analyse</button>
          <button className={view === 'live' ? 'nav-link active' : 'nav-link'} onClick={() => setView('live')} type="button">🔴 Live Studio</button>
          <button className={view === 'settings' ? 'nav-link active' : 'nav-link'} onClick={() => setView('settings')} type="button">Settings</button>
          {installPrompt && (
            <button
              type="button"
              className="install-pwa-btn"
              onClick={async () => {
                if (installPrompt) {
                  installPrompt.prompt()
                  const choice = await installPrompt.userChoice
                  if (choice && choice.outcome === 'accepted') setInstallPrompt(null)
                }
              }}
              title="ähm-zähler als Web-App installieren"
            >
              📱 App installieren
            </button>
          )}
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
        <LiveStudio
          words={words}
          onOpenInAnalysis={(res, audioFile) => {
            setResult(res)
            if (audioFile) setFile(audioFile)
            setUrl('')
            setActiveHistoryId(null)
            setView('analyse')
          }}
          onSaveToHistory={(entry) => {
            setHistory((prev) => [entry, ...prev.filter((h) => h.id !== entry.id)])
          }}
        />
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
                      placeholder="YouTube-Link, Podcast-RSS oder MP3-URL..."
                    />
                  </div>
                  {isFetchingMediaInfo && (
                    <div className="url-preview-card loading">
                      <div className="url-preview-spinner" />
                      <span>Ermittle Medien-Titel & Dauer…</span>
                    </div>
                  )}
                  {fetchedMediaInfo && !isFetchingMediaInfo && (
                    <div className="url-preview-card">
                      <span className="url-preview-badge-icon">🎬</span>
                      <div className="url-preview-meta">
                        <strong className="url-preview-title">{fetchedMediaInfo.title}</strong>
                        <span className="url-preview-sub">
                          {fetchedMediaInfo.uploader ? `${fetchedMediaInfo.uploader} • ` : ''}
                          {fetchedMediaInfo.duration ? `${formatTimestamp(fetchedMediaInfo.duration)} Min.` : 'Audio-Quelle'}
                        </span>
                      </div>
                    </div>
                  )}
                  <small>YouTube, Podcast RSS-Feeds oder direkte Audio-/Videolinks werden unterstützt.</small>
                </div>
              </div>

              <div className="analysis-details">
                <input value={analysisTitle} onChange={(event) => setAnalysisTitle(event.target.value)} placeholder="Titel der Analyse (optional)" />
                <input value={analysisTags} onChange={(event) => setAnalysisTags(event.target.value)} placeholder="Tags, z. B. Podcast, Training" />
                <textarea value={analysisNote} onChange={(event) => setAnalysisNote(event.target.value)} placeholder="Notiz zur Aufnahme (optional)" rows={2} />
              </div>

              <button className="analyze-button" type="button" disabled={!isAnalyzing && (!file && !url)} onClick={isAnalyzing ? cancelAnalysis : () => analyze()}>
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
                          className="report-btn report-btn-share"
                          onClick={copyShareLink}
                          title="Direkten Link zur Analyse kopieren und teilen"
                        >
                          {copyStatus === 'copied-link' ? '✓ Link kopiert!' : '🔗 Link teilen'}
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

                  <div className="metrics metrics-4col">
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
                    <div>
                      <b>Sprechpausen (&gt;1,2s)</b>
                      <strong>{result.pauseCount ?? calculatePauses(result.segments || []).count}</strong>
                      <span>{result.totalPauseSeconds ? `${result.totalPauseSeconds}s gesamt` : 'bewusst gesetzt'}</span>
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

                  {/* 📈 Sprechtempo-Verlauf (WPM Timeline) */}
                  {result.segments && result.segments.length > 0 && result.duration > 0 && (() => {
                    const segs = result.segments
                    const computedWpms = segs.map((s) => {
                      if (s.wpm !== undefined && s.wpm > 0) return s.wpm
                      const segWords = s.text.trim() ? s.text.trim().split(/\s+/).length : 0
                      const durMin = Math.max(0.01, (s.end - s.start) / 60)
                      return Math.round(segWords / durMin)
                    })
                    const maxWpm = Math.max(180, ...computedWpms)
                    const avgWpm = Math.round(computedWpms.reduce((a, b) => a + b, 0) / (computedWpms.length || 1))

                    return (
                      <div className="wpm-timeline-card">
                        <div className="wpm-header-flex">
                          <div>
                            <div className="section-label">📈 Sprechtempo-Verlauf (Wörter / Minute)</div>
                            <span className="wpm-subtext">
                              Ø <strong>{avgWpm} WPM</strong> • Klicke auf einen Abschnitt, um dorthin zu springen.
                            </span>
                          </div>
                          <div className="wpm-legend-pills">
                            <span className="wpm-pill wpm-pill-calm">● &lt;110 Ruhig</span>
                            <span className="wpm-pill wpm-pill-optimal">● 110–155 Optimal</span>
                            <span className="wpm-pill wpm-pill-fast">● &gt;155 Hektisch</span>
                          </div>
                        </div>

                        <div className="wpm-chart-track" title="Sprechtempo über die Zeit">
                          {segs.map((seg, i) => {
                            const wpm = computedWpms[i] || 0
                            const leftPercent = (seg.start / (result.duration || 1)) * 100
                            const widthPercent = Math.max(0.8, ((seg.end - seg.start) / (result.duration || 1)) * 100)
                            const heightPercent = Math.min(100, Math.max(18, (wpm / maxWpm) * 100))
                            let colorClass = 'wpm-bar-optimal'
                            if (wpm < 110) colorClass = 'wpm-bar-calm'
                            else if (wpm > 155) colorClass = 'wpm-bar-fast'

                            return (
                              <div
                                key={i}
                                className={`wpm-bar-segment ${colorClass}`}
                                style={{
                                  left: `${leftPercent}%`,
                                  width: `${widthPercent}%`,
                                  height: `${heightPercent}%`,
                                }}
                                title={`${formatTimestamp(seg.start)}: ${wpm} WPM — „${seg.text.slice(0, 45)}...“`}
                                onClick={() => seekAndPlay(seg.start)}
                              />
                            )
                          })}
                        </div>
                      </div>
                    )
                  })()}

                  {/* 👥 Sprecher-Analyse & Trennung */}
                  {result && (() => {
                    const spList = result.speakers && Object.keys(result.speakers).length > 0
                      ? Object.values(result.speakers)
                      : [
                          {
                            id: 'speaker_1',
                            name: 'Sprecher 1',
                            color: '#3b82f6',
                            totalWords: result.totalWords || 0,
                            fillerWords: result.fillerWords || 0,
                            baseFillerWords: result.fillerWords || 0,
                            relativeRate: result.relativeRate || 0,
                            duration: result.duration || 0,
                            wpm: result.duration > 0 ? Math.round(((result.totalWords || 0) / (result.duration / 60))) : 0,
                            counts: result.counts || {},
                          }
                        ]
                    const totalFillers = Math.max(1, result.fillerWords)

                    return (
                      <div className="speakers-analysis-card">
                        <div className="speakers-header">
                          <div>
                            <div className="section-label">👥 Sprecher-Analyse & Trennung</div>
                            <p className="speakers-subtext">Automatische Erkennung. Klicke auf ✎ zum Umbenennen oder weise Abschnitte zu.</p>
                          </div>
                          <div className="speakers-header-actions">
                            <span className="speakers-count-badge">
                              {spList.length === 1 ? '1 Sprecher' : `${spList.length} Sprecher`}
                            </span>
                            <button
                              type="button"
                              className="add-speaker-btn"
                              onClick={addNewSpeaker}
                              title="Weiteren Sprecher für Interviews / Co-Hosts hinzufügen"
                            >
                              + Sprecher hinzufügen
                            </button>
                          </div>
                        </div>

                        {/* Speaker Cards Grid */}
                        <div className="speakers-grid">
                          {spList.map((sp) => {
                            const isEditing = editingSpeakerId === sp.id
                            const topWords = Object.entries(sp.counts || {})
                              .filter(([, c]) => c > 0)
                              .sort(([, a], [, b]) => b - a)
                              .slice(0, 3)

                            return (
                              <div key={sp.id} className="speaker-card" style={{ borderTopColor: sp.color }}>
                                <div className="speaker-card-header">
                                  <div className="speaker-avatar" style={{ background: sp.color }}>
                                    {sp.name.charAt(0).toUpperCase()}
                                  </div>
                                  <div className="speaker-name-area">
                                    {isEditing ? (
                                      <div className="speaker-inline-edit">
                                        <input
                                          value={editingSpeakerName}
                                          onChange={(e) => setEditingSpeakerName(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') renameSpeaker(sp.id, editingSpeakerName)
                                            if (e.key === 'Escape') setEditingSpeakerId(null)
                                          }}
                                          autoFocus
                                        />
                                        <button type="button" onClick={() => renameSpeaker(sp.id, editingSpeakerName)}>✓</button>
                                        <button type="button" onClick={() => setEditingSpeakerId(null)}>×</button>
                                      </div>
                                    ) : (
                                      <div className="speaker-name-display">
                                        <b>{sp.name}</b>
                                        <button
                                          type="button"
                                          className="speaker-edit-btn"
                                          onClick={() => {
                                            setEditingSpeakerId(sp.id)
                                            setEditingSpeakerName(sp.name)
                                          }}
                                          title="Namen bearbeiten"
                                        >
                                          ✎
                                        </button>
                                      </div>
                                    )}
                                    <span className="speaker-meta-time">
                                      {Math.floor(sp.duration / 60)}:{String(Math.round(sp.duration % 60)).padStart(2, '0')} min ({sp.totalWords} Wörter)
                                    </span>
                                  </div>
                                </div>

                                <div className="speaker-metrics-row">
                                  <div className="speaker-metric">
                                    <span className="sm-label">Füllwörter</span>
                                    <strong className="sm-val">{sp.fillerWords}</strong>
                                  </div>
                                  <div className="speaker-metric">
                                    <span className="sm-label">Quote</span>
                                    <strong className="sm-val">{sp.relativeRate.toFixed(1)} %</strong>
                                  </div>
                                  <div className="speaker-metric">
                                    <span className="sm-label">Tempo</span>
                                    <strong className="sm-val">{sp.wpm} <small>WPM</small></strong>
                                  </div>
                                </div>

                                {topWords.length > 0 && (
                                  <div className="speaker-top-words">
                                    <span className="stw-label">Top:</span>
                                    {topWords.map(([w, c]) => (
                                      <span key={w} className="speaker-word-chip">„{w}“ <b>{c}×</b></span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>

                        {/* Head-to-Head Comparison Bar */}
                        {spList.length === 2 && (
                          <div className="speakers-compare-section">
                            <div className="compare-bar-label">
                              <span>🔴 Füllwort-Verteilung: <b>{spList[0].name} ({Math.round((spList[0].fillerWords / totalFillers) * 100)}%)</b></span>
                              <span><b>{spList[1].name} ({Math.round((spList[1].fillerWords / totalFillers) * 100)}%)</b></span>
                            </div>
                            <div className="speakers-compare-track">
                              <div
                                className="compare-segment"
                                style={{
                                  width: `${Math.max(5, Math.min(95, (spList[0].fillerWords / totalFillers) * 100))}%`,
                                  background: spList[0].color,
                                }}
                              />
                              <div
                                className="compare-segment"
                                style={{
                                  width: `${Math.max(5, Math.min(95, (spList[1].fillerWords / totalFillers) * 100))}%`,
                                  background: spList[1].color,
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  <div className="waveform-bar-card sniper-card">
                    <div className="timeline-header-flex">
                      <div className="sniper-title-group">
                        <span className="section-label">🎯 Füllwort- & Pausen-Sniper</span>
                      </div>
                      <div className="sniper-header-pills">
                        {currentMediaTitle && (
                          <div className="media-pill-tag" title={currentMediaTitle}>
                            <span className="pill-dot">●</span>
                            <span className="pill-text">{currentMediaTitle}</span>
                          </div>
                        )}
                        <span className="sniper-summary-tag">
                          {fillerSegments.length} Füllwörter {pauseSegments.length > 0 ? `· ${pauseSegments.length} Pausen` : ''}
                        </span>
                      </div>
                    </div>

                    <div
                      className="waveform-timeline"
                      title="Klicke auf die Timeline, um direkt dorthin zu springen"
                      onClick={(e) => {
                        if (!result?.duration) return
                        const rect = e.currentTarget.getBoundingClientRect()
                        const clickX = e.clientX - rect.left
                        const ratio = Math.max(0, Math.min(1, clickX / rect.width))
                        seekAndPlay(ratio * result.duration)
                      }}
                    >
                      <div className="timeline-track" />

                      {/* Pauses markers */}
                      {pauseSegments.map((p) => {
                        const leftPercent = (p.start / (result.duration || 1)) * 100
                        const widthPercent = Math.max(0.8, (p.duration / (result.duration || 1)) * 100)
                        return (
                          <div
                            key={p.id}
                            className="timeline-pause-marker"
                            style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
                            title={`Pause (${p.duration.toFixed(1)}s) bei ${formatTimestamp(p.start)} - ${formatTimestamp(p.end)}`}
                          />
                        )
                      })}

                      {/* Filler markers */}
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

                      {/* Interactive Playhead Needle */}
                      {result?.duration && result.duration > 0 && (
                        <div
                          className="timeline-playhead"
                          style={{ left: `${Math.min(100, Math.max(0, (activePlayTime / result.duration) * 100))}%` }}
                          title={`Aktuelle Wiedergabe: ${formatTimestamp(activePlayTime)}`}
                        />
                      )}
                    </div>

                    <div className="sniper-controls-grid">
                      <div className="sniper-row">
                        <span className="sniper-row-label">🔴 Füllwörter:</span>
                        <div className="sniper-btn-group">
                          <button
                            type="button"
                            className="player-control-button"
                            onClick={() => jumpToFiller('prev')}
                            disabled={!fillerSegments.length}
                            title="Tastenkürzel: Alt + Pfeil links"
                          >
                            ⏮️ Vorheriges
                          </button>
                          <span className="sniper-counter-badge">
                            {currentFillerIndex >= 0 ? currentFillerIndex + 1 : 0} / {fillerSegments.length}
                          </span>
                          <button
                            type="button"
                            className="player-control-button"
                            onClick={() => jumpToFiller('next')}
                            disabled={!fillerSegments.length}
                            title="Tastenkürzel: Alt + Pfeil rechts"
                          >
                            Nächstes ⏭️
                          </button>
                        </div>
                      </div>

                      {pauseSegments.length > 0 && (
                        <div className="sniper-row">
                          <span className="sniper-row-label">⏱️ Pausen ({'>'}1.8s):</span>
                          <div className="sniper-btn-group">
                            <button
                              type="button"
                              className="player-control-button pause-btn"
                              onClick={() => jumpToPause('prev')}
                              disabled={!pauseSegments.length}
                              title="Tastenkürzel: Alt + Pfeil hoch"
                            >
                              ⏮️ Vorherige
                            </button>
                            <span className="sniper-counter-badge pause">
                              {currentPauseIndex >= 0 ? currentPauseIndex + 1 : 0} / {pauseSegments.length}
                            </span>
                            <button
                              type="button"
                              className="player-control-button pause-btn"
                              onClick={() => jumpToPause('next')}
                              disabled={!pauseSegments.length}
                              title="Tastenkürzel: Alt + Pfeil runter"
                            >
                              Nächste ⏭️
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="sniper-row-actions">
                        <button
                          type="button"
                          className={isSupercutActive ? 'player-control-button supercut-btn active' : 'player-control-button supercut-btn'}
                          onClick={() => setIsSupercutActive(!isSupercutActive)}
                          disabled={!fillerSegments.length}
                        >
                          🎧 {isSupercutActive ? 'Supercut beenden' : 'Füllwort-Supercut abspielen'}
                        </button>
                        <div className="keyboard-shortcut-hint" title="Navigiere blitzschnell mit der Tastatur">
                          ⌨️ <kbd>Alt</kbd> + <kbd>←</kbd>/<kbd>→</kbd> Füllwörter · <kbd>Alt</kbd> + <kbd>↑</kbd>/<kbd>↓</kbd> Pausen
                        </div>
                      </div>
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
                    <div className="transcript-header-bar">
                      <div className="section-label">Transkript mit Zeitstempeln & Sprechern (Klicken zum Anhören)</div>
                      {result.speakers && Object.keys(result.speakers).length > 1 && (
                        <div className="speaker-filter-pills">
                          <button
                            type="button"
                            className={speakerFilter === 'all' ? 'speaker-pill active' : 'speaker-pill'}
                            onClick={() => setSpeakerFilter('all')}
                          >
                            Alle Sprecher ({result.segments?.length || 0})
                          </button>
                          {Object.values(result.speakers).map((sp) => (
                            <button
                              key={sp.id}
                              type="button"
                              className={speakerFilter === sp.id ? 'speaker-pill active' : 'speaker-pill'}
                              style={{
                                borderColor: sp.color,
                                color: speakerFilter === sp.id ? 'white' : sp.color,
                                background: speakerFilter === sp.id ? sp.color : undefined
                              }}
                              onClick={() => setSpeakerFilter(sp.id)}
                            >
                              👤 {sp.name} ({sp.fillerWords} Ähs)
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {file && (
                      <audio
                        className="playback"
                        ref={playbackRef}
                        src={playbackUrl}
                        controls
                        onTimeUpdate={(e) => setActivePlayTime(e.currentTarget.currentTime)}
                      />
                    )}

                    <div className="transcript-list">
                      {(result.segments || [])
                        .filter((seg) => speakerFilter === 'all' || seg.speakerId === speakerFilter)
                        .map((segment, segIdx) => {
                          const sp = result.speakers?.[segment.speakerId || 'speaker_1']
                          const spColor = sp?.color || '#3b82f6'
                          const spName = segment.speakerName || sp?.name || 'Sprecher 1'

                          return (
                            <div className="transcript-segment-row" key={`${segment.start}-${segment.end}-${segIdx}`}>
                              <button
                                className="transcript-segment-btn"
                                type="button"
                                onClick={() => seekAndPlay(segment.start)}
                              >
                                <span className="transcript-time">{formatTimestamp(segment.start)}</span>
                                {result.speakers && Object.keys(result.speakers).length > 1 && (
                                  <span
                                    className="transcript-speaker-tag"
                                    style={{
                                      background: `${spColor}18`,
                                      color: spColor,
                                      borderColor: `${spColor}44`
                                    }}
                                    title={`Sprecher: ${spName}`}
                                  >
                                    👤 {spName}
                                  </span>
                                )}
                                <strong className="transcript-text-content">{segment.text}</strong>
                              </button>

                              {result.speakers && Object.keys(result.speakers).length > 1 && (
                                <select
                                  className="segment-speaker-select"
                                  value={segment.speakerId || 'speaker_1'}
                                  onChange={(e) => reassignSegmentSpeaker(segIdx, e.target.value)}
                                  title="Sprecher für diesen Abschnitt ändern"
                                >
                                  {Object.values(result.speakers).map((s) => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                  ))}
                                </select>
                              )}
                            </div>
                          )
                        })}
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
                                  setResult(ensureMultiSpeakerDiarization(entry.result, words))
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

        <div className="presets-container">
          <span className="presets-label">⚡ Schnell-Vorlagen / Presets:</span>
          <div className="presets-btn-group">
            {[
              {
                id: 'classic',
                label: 'Klassisch',
                icon: '🎯',
                words: ['äh', 'ähm', 'öh', 'hm', 'mhm'],
              },
              {
                id: 'rhetoric',
                label: 'Rhetorik & Weichmacher',
                icon: '💬',
                words: ['eigentlich', 'sozusagen', 'quasi', 'im endeffekt', 'praktisch', 'gewissermaßen', 'am ende des tages', 'ich sag mal'],
              },
              {
                id: 'dups',
                label: 'Wortdopplungen',
                icon: '🔁',
                words: ['ich ich', 'wir wir', 'und und', 'aber aber', 'also also', 'dann dann'],
              },
            ].map((preset) => {
              const normalizedPreset = preset.words.map((w) => w.trim().toLowerCase())
              const currentNormalized = words.map((w) => w.trim().toLowerCase())
              const presentCount = normalizedPreset.filter((w) => currentNormalized.includes(w)).length
              const isAllActive = presentCount === normalizedPreset.length
              const isPartial = presentCount > 0 && !isAllActive
              const missingCount = normalizedPreset.length - presentCount

              const handleToggle = () => {
                if (isAllActive) {
                  // Toggle OFF: remove these preset words
                  const remaining = words.filter((w) => !normalizedPreset.includes(w.trim().toLowerCase()))
                  setWords(remaining.length > 0 ? remaining : ['äh', 'ähm'])
                } else {
                  // Add only missing words
                  const newWords = [...words]
                  normalizedPreset.forEach((w) => {
                    if (!newWords.some((existing) => existing.trim().toLowerCase() === w)) {
                      newWords.push(w)
                    }
                  })
                  setWords(newWords)
                }
              }

              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`preset-tag-btn ${isAllActive ? 'active' : isPartial ? 'partial' : ''}`}
                  onClick={handleToggle}
                  title={
                    isAllActive
                      ? `Alle ${preset.words.length} Wörter aktiv. Klicken zum Abwählen.`
                      : isPartial
                      ? `${presentCount} bereits aktiv, ${missingCount} fehlende hinzufügen.`
                      : `Alle ${preset.words.length} Wörter hinzufügen.`
                  }
                >
                  <span>{preset.icon}</span>
                  <span>
                    {isAllActive
                      ? `✓ ${preset.label} (${preset.words.length})`
                      : isPartial
                      ? `+ ${preset.label} (+${missingCount})`
                      : `${preset.label} (+${preset.words.length})`}
                  </span>
                </button>
              )
            })}
            <button
              type="button"
              className="preset-tag-btn preset-tag-reset"
              onClick={() => setWords(['äh', 'ähm'])}
              title="Auf Standard zurücksetzen"
            >
              ↺ Standard (äh, ähm)
            </button>
          </div>
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
const FILLER_VARIANT_MAP: Record<string, string[][][]> = {
  "äh": [
    [["äh", "ä", "ah", "aeh", "eh", "er", "öh", "oeh", "ähh", "ähhh", "ää", "äääh", "uh", "a"]]
  ],
  "ähm": [
    [["ähm", "m", "em", "mm", "mmm", "hm", "hmm", "hmmm", "ahm", "am", "öhm", "oehm", "uhm", "erm", "äm", "aem", "äähm", "äh", "aehm", "ehm"]]
  ],
  "öh": [
    [["öh", "oeh", "öhm", "ö", "uh", "er"]]
  ],
  "hm": [
    [["hm", "hmm", "hmmm", "mhm", "m", "mm", "em"]]
  ],
  "mhm": [
    [["mhm", "mm-hmm", "mmhmm", "hm", "hmm"]]
  ],
  "also äh": [
    [["also", "alzo"], ["äh", "ä", "ah", "aeh", "eh", "er", "öh", "oeh", "ähh", "ää", "uh", "a"]]
  ],
  "also ähm": [
    [["also", "alzo"], ["ähm", "m", "em", "mm", "mmm", "hm", "hmm", "hmmm", "ahm", "am", "öhm", "uhm", "erm", "äm", "äähm", "ehm"]]
  ],
  "aber äh": [
    [["aber"], ["äh", "ä", "ah", "aeh", "eh", "er", "öh", "oeh", "ähh", "ää", "uh", "a"]]
  ],
  "aber ähm": [
    [["aber"], ["ähm", "m", "em", "mm", "mmm", "hm", "hmm", "hmmm", "ahm", "am", "öhm", "uhm", "erm", "äm", "äähm", "ehm"]]
  ],
  "und äh": [
    [["und"], ["äh", "ä", "ah", "aeh", "eh", "er", "öh", "oeh", "ähh", "ää", "uh", "a"]]
  ],
  "und ähm": [
    [["und"], ["ähm", "m", "em", "mm", "mmm", "hm", "hmm", "hmmm", "ahm", "am", "öhm", "uhm", "erm", "äm", "äähm", "ehm"]]
  ],
  "sozusagen": [
    [["sozusagen", "sozusagn", "sozusage", "sozesagen", "sozusagens"]],
    [["so", "soz"], ["zu", "se", "zus"], ["sagen", "sagn", "sage", "sagt"]]
  ],
  "eigentlich": [
    [["eigentlich", "eintlich", "eigentli", "eigentliche", "eigentliches", "eigentlichs", "eigentlicher"]]
  ],
  "quasi": [
    [["quasi", "quasig", "quassi", "kwaasi", "kwasi", "quasie"]]
  ],
  "praktisch": [
    [["praktisch", "praktische", "praktisches", "praktischer", "praktischerweise"]]
  ],
  "halt": [
    [["halt", "halte", "haltt"]]
  ],
  "irgendwie": [
    [["irgendwie", "irgendwas", "irgendwelche"]],
    [["irgend"], ["wie", "was", "wo", "wann"]]
  ],
  "im grunde": [
    [["im", "in"], ["grunde", "grund", "prinzip"]]
  ],
  "im endeffekt": [
    [["im", "in", "am"], ["endeffekt", "endeffek", "endefeckt"]],
    [["im", "in", "am"], ["end", "ende"], ["effekt", "effek", "effeck", "effekts"]],
    [["endeffekt", "endeffek"]]
  ],
  "am ende des tages": [
    [["am", "in", "an"], ["ende", "end"], ["des", "vom", "von", "dem", "der"], ["tages", "tags", "tag", "tage"]],
    [["am", "in", "an"], ["ende", "end"], ["tag", "tages", "tags"]],
    [["am"], ["ende"]]
  ],
  "ich sag mal": [
    [["ich", "i"], ["sag", "sage", "sach", "sagt", "sags"], ["mal", "ma", "halt"]],
    [["sag", "sage", "sach", "sags"], ["mal", "ma"]]
  ],
  "gewissermaßen": [
    [["gewissermaßen", "gewissermassen", "gewissermasen"]],
    [["gewisser", "gewisse"], ["maßen", "massen", "masen"]]
  ],
  "also": [
    [["also", "alzo"]]
  ],
  "dingsbums": [
    [["dingsbums", "dingsda", "dings", "dings-bums"]],
    [["dings"], ["bums", "bumms", "da", "dada"]]
  ],
  "scheinbar": [
    [["scheinbar", "scheinbare", "scheinbares", "scheinbarerweise"]]
  ],
  "genau": [
    [["genau", "jenau", "jegenau"]]
  ]
};

function countTargetInTokens(tokens: string[], target: string): number {
  const normTarget = target.toLowerCase().trim()
  if (!normTarget || !tokens.length) return 0

  const variantEntry = FILLER_VARIANT_MAP[normTarget]
  if (variantEntry && variantEntry.length > 0) {
    let count = 0
    let i = 0
    while (i < tokens.length) {
      let matchedLen = 0
      for (const patternSeq of variantEntry) {
        const plen = patternSeq.length
        if (i + plen <= tokens.length) {
          let seqMatch = true
          for (let j = 0; j < plen; j++) {
            const allowed = patternSeq[j]
            const curr = tokens[i + j]
            if (!allowed.some(v => v === curr || (curr.length > 3 && (curr.startsWith(v) || v.startsWith(curr))))) {
              seqMatch = false
              break
            }
          }
          if (seqMatch) {
            matchedLen = Math.max(matchedLen, plen)
          }
        }
      }

      if (matchedLen > 0) {
        count++
        i += matchedLen
      } else {
        i++
      }
    }
    return count
  }

  // General multi-word or custom word matching with prefix/stem flexibility
  const targetTokens = normTarget.match(/[\p{L}\p{N}]+/gu) || [normTarget]
  const plen = targetTokens.length
  let count = 0
  let i = 0
  while (i <= tokens.length - plen) {
    let match = true
    for (let j = 0; j < plen; j++) {
      const t = targetTokens[j]
      const actual = tokens[i + j]
      if (actual !== t) {
        if (t.length > 3 && (actual.startsWith(t) || t.startsWith(actual))) {
          // OK stem match
        } else {
          match = false
          break
        }
      }
    }
    if (match) {
      count++
      i += plen
    } else {
      i++
    }
  }
  return count
}

function LiveStudio({
  words,
  onOpenInAnalysis,
  onSaveToHistory
}: {
  words: string[]
  onOpenInAnalysis?: (result: Result, audioFile?: File) => void
  onSaveToHistory?: (entry: HistoryEntry) => void
}) {
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
  
  // Audio recording state
  const [recordedAudioBlob, setRecordedAudioBlob] = useState<Blob | null>(null)
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null)
  const [liveReportResult, setLiveReportResult] = useState<Result | null>(null)
  const [showReportModal, setShowReportModal] = useState(false)
  const [copiedReport, setCopiedReport] = useState(false)

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
  
  // Audio recording refs
  const audioRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const mediaStreamRef = useRef<MediaStream | null>(null)

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
      let stream = mediaStreamRef.current
      if (!stream || !stream.active) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        mediaStreamRef.current = stream
      }
      void startVisualizer(stream)

      // Start / Resume MediaRecorder for audio saving
      if (!audioRecorderRef.current || audioRecorderRef.current.state === "inactive") {
        try {
          const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus"
            : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : MediaRecorder.isTypeSupported("audio/mp4")
            ? "audio/mp4"
            : undefined

          const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
          audioRecorderRef.current = recorder

          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              audioChunksRef.current.push(e.data)
            }
          }

          recorder.onstop = () => {
            if (audioChunksRef.current.length > 0) {
              const mime = audioChunksRef.current[0]?.type || "audio/webm"
              const blob = new Blob(audioChunksRef.current, { type: mime })
              setRecordedAudioBlob(blob)
              const url = URL.createObjectURL(blob)
              setRecordedAudioUrl(url)
            }
          }

          recorder.start(1000)
        } catch (recErr) {
          console.warn("[LiveStudio] MediaRecorder init error:", recErr)
        }
      } else if (audioRecorderRef.current.state === "paused") {
        audioRecorderRef.current.resume()
      }

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

        const fullTokens = fullTranscript.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []

        // Combine total counts: ensure both full transcript scanning and segment alternatives are captured
        const totalCounts: Record<string, number> = {}
        for (const w of words) {
          const directCount = countTargetInTokens(fullTokens, w)
          let segSum = 0
          segmentFillersRef.current.forEach((segCounts) => {
            segSum += (segCounts[w] || 0)
          })
          totalCounts[w] = Math.max(directCount, segSum)
        }

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
        if (fullTokens.length > 0 && secs > 0) {
          const wpm = Math.round((fullTokens.length / secs) * 60)
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
      setLastAlert("Live-Erkennung & Aufnahme aktiv. Sprich frei ins Mikrofon!")
    } catch (e: any) {
      console.error("[LiveStudio] startListening CATCH:", e)
      if (e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError" || String(e).includes("denied permission") || String(e).includes("not allowed")) {
        setLastAlert("🎙️ Mikrofon-Zugriff blockiert: Bitte klicke oben in der Browser-Adressleiste auf das Schloss/Regler-Symbol, setze 'Mikrofon' auf 'Zulassen' und lade die Seite neu.")
      } else {
        const msg = e instanceof Error ? e.message : String(e)
        setLastAlert(`Fehler beim Starten: ${msg}`)
      }
    }
  }

  const stopListening = () => {
    isListeningRef.current = false
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    if (audioRecorderRef.current && audioRecorderRef.current.state === "recording") {
      try {
        audioRecorderRef.current.pause()
      } catch (e) {
        console.warn("Could not pause recorder:", e)
      }
    }
    stopVisualizer()
    setIsListening(false)
  }

  const finishSessionAndShowReport = () => {
    // 1. Stop SpeechRecognition & Recorder
    isListeningRef.current = false
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    if (audioRecorderRef.current && audioRecorderRef.current.state !== "inactive") {
      try {
        audioRecorderRef.current.stop()
      } catch (e) {
        console.warn("Could not stop audioRecorder:", e)
      }
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }
    stopVisualizer()
    setIsListening(false)

    // 2. Aggregate final stats
    const fullText = (
      (accumulatedFinalTextRef.current ? accumulatedFinalTextRef.current + " " : "") +
      (liveTranscript || "")
    ).trim()
    const tokens = fullText.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []
    const totalWords = tokens.length

    const finalCounts: Record<string, number> = {}
    for (const w of words) {
      const directCount = countTargetInTokens(tokens, w)
      let segSum = 0
      segmentFillersRef.current.forEach((seg) => {
        segSum += (seg[w] || 0)
      })
      finalCounts[w] = Math.max(directCount, segSum)
    }

    const totalFiller = Object.values(finalCounts).reduce((a, b) => a + b, 0)
    const relativeRate = totalWords > 0 ? (totalFiller / totalWords) * 100 : 0
    const duration = Math.max(1, elapsedSecondsRef.current)
    const baseFillerWords = (finalCounts["äh"] || 0) + (finalCounts["ähm"] || 0)

    const segments: TranscriptSegment[] = []
    if (fullText) {
      segments.push({
        start: 0,
        end: duration,
        text: fullText,
        counts: { ...finalCounts },
        wpm: totalWords > 0 ? Math.round((totalWords / duration) * 60) : 0
      })
    }

    const sessionResult: Result = {
      counts: finalCounts,
      fillerWords: totalFiller,
      baseFillerWords,
      totalWords,
      relativeRate,
      duration,
      text: fullText,
      segments,
      mediaTitle: `Live Studio Training (${new Date().toLocaleDateString("de-DE")})`
    }

    setLiveReportResult(sessionResult)
    setShowReportModal(true)

    // Save to history automatically
    if (onSaveToHistory) {
      const historyEntry: HistoryEntry = {
        id: "live-" + Date.now(),
        source: "live-mic",
        sourceLabel: `Live Studio (${new Date().toLocaleDateString("de-DE")} ${new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })})`,
        createdAt: new Date().toISOString(),
        result: sessionResult,
        words: [...words],
        title: `Live Studio Training (${new Date().toLocaleDateString("de-DE")})`,
        note: `Live-Aufnahme mit ${totalFiller} Füllwörtern bei ${totalWords > 0 ? Math.round((totalWords / duration) * 60) : 0} WPM`,
        tags: ["Live Studio", "Training"]
      }
      onSaveToHistory(historyEntry)
    }
  }

  const resetLiveSession = () => {
    stopListening()
    if (audioRecorderRef.current && audioRecorderRef.current.state !== "inactive") {
      try {
        audioRecorderRef.current.stop()
      } catch (e) {
        // ignore
      }
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }
    audioChunksRef.current = []
    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl)
    }
    setRecordedAudioBlob(null)
    setRecordedAudioUrl(null)
    setLiveReportResult(null)
    setShowReportModal(false)
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

  const handleCopyReport = () => {
    if (!liveReportResult) return
    const wpm = liveReportResult.totalWords > 0 ? Math.round((liveReportResult.totalWords / liveReportResult.duration) * 60) : 0
    const lines = [
      `📊 Live Studio Trainings-Report — ${new Date().toLocaleDateString("de-DE")}`,
      `⏱️ Dauer: ${formatTimestamp(liveReportResult.duration)} min | 🗣️ Wörter: ${liveReportResult.totalWords} | 📈 Tempo: ${wpm} WPM`,
      `🔴 Füllwörter gesamt: ${liveReportResult.fillerWords} (${liveReportResult.relativeRate.toFixed(1)} % Quote)`,
      ``,
      `📋 Füllwort-Aufschlüsselung:`,
      ...Object.entries(liveReportResult.counts)
        .filter(([_, count]) => count > 0)
        .map(([word, count]) => `• „${word}“: ${count}x`),
      ``,
      `📝 Transkript:`,
      `"${liveReportResult.text}"`
    ]
    navigator.clipboard.writeText(lines.join("\n"))
    setCopiedReport(true)
    setTimeout(() => setCopiedReport(false), 2500)
  }

  const handleDownloadTxt = () => {
    if (!liveReportResult) return
    const blob = new Blob([liveReportResult.text], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `live-transkript-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleOpenInMainAnalysis = () => {
    if (!liveReportResult) return
    let audioFile: File | undefined = undefined
    if (recordedAudioBlob) {
      audioFile = new File([recordedAudioBlob], `live-recording-${Date.now()}.webm`, {
        type: recordedAudioBlob.type || "audio/webm"
      })
    }
    setShowReportModal(false)
    onOpenInAnalysis?.(liveReportResult, audioFile)
  }

  // Calculate Rhetoric Score (0-100)
  const calculateRhetoricScore = (res: Result) => {
    const fillerPenalty = Math.min(60, res.relativeRate * 8)
    const wpm = res.totalWords > 0 ? Math.round((res.totalWords / res.duration) * 60) : 130
    let tempoPenalty = 0
    if (wpm < 100) tempoPenalty = (100 - wpm) * 0.4
    else if (wpm > 175) tempoPenalty = (wpm - 175) * 0.4
    const score = Math.max(10, Math.min(100, Math.round(100 - fillerPenalty - tempoPenalty)))
    return score
  }

  // Highlight filler words inside transcript text
  const renderHighlightedTranscript = (text: string) => {
    if (!text) return <em>Kein Text gesprochen</em>
    const wordsInText = text.split(/(\s+)/)
    return wordsInText.map((chunk, idx) => {
      const cleanChunk = chunk.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
      const isFiller = cleanChunk && words.some((w) => {
        const norm = w.toLowerCase().trim()
        if (cleanChunk === norm) return true
        if (norm.length > 3 && cleanChunk.startsWith(norm)) return true
        if (norm === "äh" && ["äh", "ä", "ah", "aeh", "eh", "er", "öh"].includes(cleanChunk)) return true
        if (norm === "ähm" && ["ähm", "em", "mm", "hm", "hmm", "öhm", "ehm"].includes(cleanChunk)) return true
        return false
      })

      if (isFiller) {
        return (
          <mark key={idx} className="live-transcript-filler-mark">
            {chunk}
          </mark>
        )
      }
      return <span key={idx}>{chunk}</span>
    })
  }

  const hasActivity = elapsedSeconds > 0 || liveTranscript.length > 0 || liveCount > 0

  return (
    <section className="live-studio-view">
      <div className="live-studio-header">
        <div className="live-studio-header-titles">
          <span className="eyebrow">ECHTZEIT-SPRECHFLUSS-TRAINER & AUFNAHME</span>
          <h1>🔴 Live Studio — <em>Präsentation live üben & aufzeichnen</em></h1>
          <p className="intro-copy">Sprich frei ins Mikrofon. Füllwörter werden live gezählt, die Stimme aufgezeichnet und nach der Session als Report ausgewertet.</p>
        </div>
        <div className="live-header-status-badge">
          <span className={isListening ? "live-mic-dot recording" : "live-mic-dot"} />
          <b>{isListening ? "LIVE-AUFNAHME AKTIV" : hasActivity ? "PAUSIERT" : "BEREIT"}</b>
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
              <span>{isListening ? "Mikrofon nimmt auf..." : hasActivity ? "Aufnahme pausiert" : "Standby"}</span>
            </div>
          </div>

          <div className="live-controls">
            {!isListening ? (
              <button type="button" className="live-start-button" onClick={startListening}>
                <span>{hasActivity ? "▶️ Fortsetzen" : "🎙️ Starten"}</span>
              </button>
            ) : (
              <button type="button" className="live-stop-button" onClick={stopListening}>
                <span>⏸️ Pause</span>
              </button>
            )}

            {hasActivity && (
              <button type="button" className="live-finish-button" onClick={finishSessionAndShowReport} title="Session beenden und detaillierten Report öffnen">
                <span>🏁 Auswerten</span>
              </button>
            )}

            <button type="button" className="history-clear-button" onClick={resetLiveSession} title="Zurücksetzen">
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

      {/* POST-SESSION LIVE REPORT MODAL */}
      {showReportModal && liveReportResult && (
        <div className="live-report-modal-backdrop" onClick={() => setShowReportModal(false)}>
          <div className="live-report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="live-report-header">
              <div className="live-report-header-text">
                <span className="eyebrow">TRAININGS-AUSWERTUNG</span>
                <h2>🎉 Live-Session Report</h2>
                <p className="live-report-meta">
                  Aufnahme vom {new Date().toLocaleDateString("de-DE")} um {new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr • Dauer: <b>{formatTimestamp(liveReportResult.duration)} min</b>
                </p>
              </div>
              <button type="button" className="live-modal-close" onClick={() => setShowReportModal(false)} title="Schließen">
                ✕
              </button>
            </div>

            {/* Score & KPI Summary Cards */}
            <div className="live-report-summary-cards">
              <div className="live-report-score-card">
                <div className="live-score-number">{calculateRhetoricScore(liveReportResult)}</div>
                <div className="live-score-label">
                  <b>Rhetorik-Score</b>
                  <span>
                    {calculateRhetoricScore(liveReportResult) >= 85
                      ? "🟢 Exzellent & flüssig"
                      : calculateRhetoricScore(liveReportResult) >= 70
                      ? "🟡 Guter Vortrag mit kleinen Pausen"
                      : calculateRhetoricScore(liveReportResult) >= 50
                      ? "🟠 Leicht unruhig"
                      : "🔴 Hoher Füllwort-Anteil"}
                  </span>
                </div>
              </div>

              <div className="live-report-kpi-grid">
                <div className="live-kpi-box">
                  <span className="live-kpi-label">Füllwörter gesamt</span>
                  <span className="live-kpi-val highlight">{liveReportResult.fillerWords}</span>
                </div>
                <div className="live-kpi-box">
                  <span className="live-kpi-label">Füllwort-Quote</span>
                  <span className="live-kpi-val">{liveReportResult.relativeRate.toFixed(1)} %</span>
                </div>
                <div className="live-kpi-box">
                  <span className="live-kpi-label">Gesprochene Wörter</span>
                  <span className="live-kpi-val">{liveReportResult.totalWords}</span>
                </div>
                <div className="live-kpi-box">
                  <span className="live-kpi-label">Durchschn. Tempo</span>
                  <span className="live-kpi-val">
                    {liveReportResult.totalWords > 0 ? Math.round((liveReportResult.totalWords / liveReportResult.duration) * 60) : 0} WPM
                  </span>
                </div>
              </div>
            </div>

            {/* Audio Recording Playback & Download */}
            {recordedAudioUrl && (
              <div className="live-audio-player-box">
                <div className="live-audio-player-title">
                  <span>🎙️ Deine Audio-Aufnahme</span>
                  <a
                    href={recordedAudioUrl}
                    download={`live-training-${new Date().toISOString().slice(0, 10)}.webm`}
                    className="live-audio-download-btn"
                  >
                    💾 Audio herunterladen (.webm)
                  </a>
                </div>
                <audio controls src={recordedAudioUrl} className="live-native-audio-player" />
              </div>
            )}

            {/* Füllwörter Breakdown */}
            <div className="live-report-breakdown-box">
              <div className="live-section-title">FÜLLWORT-VERTEILUNG</div>
              <div className="live-report-words-chips">
                {words.map((w) => {
                  const count = liveReportResult.counts[w] || 0
                  return (
                    <div key={w} className={count > 0 ? "live-chip active" : "live-chip"}>
                      <span className="live-chip-word">„{w}“</span>
                      <span className="live-chip-count">{count}x</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Transcript with Highlights */}
            <div className="live-report-transcript-box">
              <div className="live-section-title">
                <span>VOLLSTÄNDIGES TRANSKRIPT</span>
                <button type="button" className="live-txt-download-btn" onClick={handleDownloadTxt}>
                  💾 als .txt speichern
                </button>
              </div>
              <div className="live-report-transcript-content">
                {renderHighlightedTranscript(liveReportResult.text)}
              </div>
            </div>

            {/* Actions Bar */}
            <div className="live-report-actions">
              <button
                type="button"
                className="live-report-primary-btn"
                onClick={handleOpenInMainAnalysis}
                title="Detaillierte Charts, PDF-Export & KI-Tipps in der Haupt-Analyse öffnen"
              >
                📊 In Haupt-Analyse öffnen
              </button>

              <button type="button" className="live-report-secondary-btn" onClick={handleCopyReport}>
                {copiedReport ? "✓ In Zwischenablage kopiert!" : "📋 Report kopieren"}
              </button>

              <button
                type="button"
                className="live-report-secondary-btn"
                onClick={() => {
                  setShowReportModal(false)
                  resetLiveSession()
                }}
              >
                🔄 Neues Training starten
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default App

