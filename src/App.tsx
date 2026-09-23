import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { defaultEstimatedAnalysisSeconds, getEstimatedAnalysisSeconds } from './progress'

const defaults = ['äh', 'ähm']

type Result = {
  counts: Record<string, number>
  fillerWords: number
  baseFillerWords: number
  totalWords: number
  relativeRate: number
  duration: number
  text: string
  segments: TranscriptSegment[]
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

const getProgressLabel = (percent: number) => {
  if (percent < 25) return 'Vorbereitung'
  if (percent < 50) return 'Medien prüfen'
  if (percent < 70) return 'Audio verarbeiten'
  if (percent < 95) return 'Transkription läuft'
  return 'Ergebnis auswerten'
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
  const [mediaDurationSeconds, setMediaDurationSeconds] = useState<number | null>(null)
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

  const fileInputRef = useRef<HTMLInputElement>(null)
  const playbackRef = useRef<HTMLAudioElement>(null)
  const analysisControllerRef = useRef<AbortController | null>(null)
  const playbackUrl = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file])

  const fillerSegments = useMemo(() => {
    if (!result?.segments) return []
    return result.segments.filter((seg) => {
      if (!seg.counts) return false
      return Object.entries(seg.counts).some(([w, count]) => words.includes(w) && count > 0)
    })
  }, [result, words])

  const jumpToFiller = (direction: 'next' | 'prev') => {
    if (!playbackRef.current || !fillerSegments.length) return
    const currentTime = playbackRef.current.currentTime
    if (direction === 'next') {
      const nextSeg = fillerSegments.find((seg) => seg.start > currentTime + 0.3) || fillerSegments[0]
      playbackRef.current.currentTime = Math.max(0, nextSeg.start - 0.1)
      void playbackRef.current.play()
    } else {
      const prevSegs = fillerSegments.filter((seg) => seg.start < currentTime - 0.5)
      const prevSeg = prevSegs.length ? prevSegs[prevSegs.length - 1] : fillerSegments[fillerSegments.length - 1]
      playbackRef.current.currentTime = Math.max(0, prevSeg.start - 0.1)
      void playbackRef.current.play()
    }
  }

  useEffect(() => {
    if (!isSupercutActive || !playbackRef.current || !fillerSegments.length) return

    const interval = window.setInterval(() => {
      if (!playbackRef.current || playbackRef.current.paused) return
      const currentTime = playbackRef.current.currentTime
      const currentSeg = fillerSegments.find((seg) => currentTime >= seg.start - 0.2 && currentTime <= seg.end + 0.3)
      if (!currentSeg) {
        const nextSeg = fillerSegments.find((seg) => seg.start > currentTime) || fillerSegments[0]
        playbackRef.current.currentTime = Math.max(0, nextSeg.start - 0.1)
      }
    }, 250)

    return () => window.clearInterval(interval)
  }, [isSupercutActive, fillerSegments])

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
      setMediaDurationSeconds(duration)
      setProgress((current) => ({ ...current, remainingSeconds: estimate }))
    }

    media.preload = 'metadata'
    media.addEventListener('loadedmetadata', onLoadedMetadata)
    media.addEventListener('error', () => {
      setMediaDurationSeconds(null)
      setProgress((current) => ({ ...current, remainingSeconds: defaultEstimatedAnalysisSeconds }))
    })

    media.load()

    return () => {
      media.removeEventListener('loadedmetadata', onLoadedMetadata)
      if (file) URL.revokeObjectURL(source)
    }
  }, [file, url])

  const sourceLabel = url || file?.name || 'Unbekannte Quelle'
  const activeHistoryEntry = useMemo(
    () => (activeHistoryId ? history.find((entry) => entry.id === activeHistoryId) : null),
    [history, activeHistoryId]
  )
  const activeSourceLabel = activeHistoryEntry
    ? (activeHistoryEntry.title || activeHistoryEntry.sourceLabel)
    : sourceLabel
  const activeSourceUrl = activeHistoryEntry?.source || (url.startsWith('http') ? url : '')

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

    let resolvedDuration = mediaDurationSeconds
    if (!file && url) {
      setProgress({ percent: 8, step: 0, label: 'Videolänge wird ermittelt', remainingSeconds: null })
      try {
        const metadataResponse = await fetch('/api/media-info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
          signal: controller.signal,
        })
        const metadata = await metadataResponse.json()
        if (!metadataResponse.ok) throw new Error(metadata.error || 'Die Medienlänge konnte nicht ermittelt werden.')
        resolvedDuration = Number(metadata.duration)
        setMediaDurationSeconds(resolvedDuration)
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') {
          setProgress({ percent: 0, step: 0, label: 'Analyse abgebrochen', remainingSeconds: null })
          setIsAnalyzing(false)
          analysisControllerRef.current = null
          return
        }
        setError(requestError instanceof Error ? requestError.message : 'Die Medienlänge konnte nicht ermittelt werden.')
        setIsAnalyzing(false)
        analysisControllerRef.current = null
        return
      }
    }

    const startedAt = Date.now()
    const analysisEstimate = getEstimatedAnalysisSeconds(resolvedDuration ?? undefined)
    const progressTimer = window.setInterval(() => {
      const elapsedSeconds = (Date.now() - startedAt) / 1000
      const progressRatio = Math.min(elapsedSeconds / analysisEstimate, 1)
      const percent = Math.min(94, Math.max(8, Math.round(progressRatio * 100)))
      const remainingSeconds = Math.max(0, analysisEstimate - elapsedSeconds)
      const label = getProgressLabel(percent)
      const step = Math.min(progressSteps.length - 1, Math.max(0, Math.round(percent / 25)))

      setProgress({
        percent,
        step,
        label,
        remainingSeconds,
      })
    }, 1000)

    const body = new FormData()
    body.append('words', JSON.stringify(words))
    if (file) body.append('file', file)
    if (url) body.append('url', url)

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        body,
        signal: controller.signal,
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Analyse fehlgeschlagen.')

      const historyEntry: HistoryEntry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        source: url || file?.name || 'Unbekannte Quelle',
        sourceLabel: url || file?.name || 'Unbekannte Quelle',
        createdAt: new Date().toISOString(),
        result: data,
        words: [...words],
        title: analysisTitle.trim() || sourceLabel,
        note: analysisNote.trim(),
        tags: analysisTags.split(',').map((tag) => tag.trim()).filter(Boolean),
      }

      setHistory((current) => [historyEntry, ...current].slice(0, 50))
      setActiveHistoryId(historyEntry.id)
      setResult(data)
      setProgress({ percent: 100, step: progressSteps.length - 1, label: 'Ergebnis fertig', remainingSeconds: 0 })
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === 'AbortError') {
        setProgress({ percent: 0, step: 0, label: 'Analyse abgebrochen', remainingSeconds: null })
        return
      }
      setError(requestError instanceof Error ? requestError.message : 'Analyse fehlgeschlagen.')
      setProgress({ percent: 0, step: 0, label: 'Fehler', remainingSeconds: 0 })
    } finally {
      window.clearInterval(progressTimer)
      setIsAnalyzing(false)
      analysisControllerRef.current = null
    }
  }

  const cancelAnalysis = () => {
    analysisControllerRef.current?.abort()
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
                <span className="live-dot">● {result ? 'Fertig' : 'Bereit'}</span>
              </div>

              {!result ? (
                <div className="empty-result">
                  <div className="waveform"><span /><span /><span /><span /><span /><span /><span /></div>
                  <p>Dein Ergebnis erscheint hier</p>
                  <small>Starte eine Analyse, um deinen Sprechfluss zu sehen.</small>
                </div>
              ) : (
                <div className="result-content">
                  <div className="result-source">
                    <div className="source-headline">
                      <span>Video / Quelle</span>
                      <span className="source-tag">Analyse fertig</span>
                    </div>
                    <strong>{activeSourceLabel}</strong>
                  </div>

                  <div className="main-count">
                    <strong>{result.fillerWords}</strong>
                    <span>Füllwörter gesamt<br /><small>(bereinigt: {result.baseFillerWords ?? result.fillerWords})</small></span>
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
                        <div className="section-label">☁️ Wort-Wolke</div>
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
                        <div className="section-label">🗺️ Heatmap-Timeline — Füllwörter über Zeit</div>
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
                                title={`${formatTimestamp(bucket.t0)} — ${bucket.count} Füllwort${bucket.count !== 1 ? 'er' : ''}`}
                                onClick={() => {
                                  if (!playbackRef.current) return
                                  playbackRef.current.currentTime = bucket.t0
                                  void playbackRef.current.play()
                                }}
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

                    <div className="section-label">Interaktive Füllwort-Timeline & Player</div>
                    <div
                      className="waveform-timeline"
                      title="Klicke auf eine Stelle, um dorthin zu springen"
                      onClick={(e) => {
                        if (!playbackRef.current || !result?.duration) return
                        const rect = e.currentTarget.getBoundingClientRect()
                        const clickX = e.clientX - rect.left
                        const ratio = Math.max(0, Math.min(1, clickX / rect.width))
                        playbackRef.current.currentTime = ratio * result.duration
                        void playbackRef.current.play()
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
                        disabled={!fillerSegments.length || !file}
                      >
                        ⏮️ Vorheriges Füllwort
                      </button>
                      <button
                        type="button"
                        className="player-control-button"
                        onClick={() => jumpToFiller('next')}
                        disabled={!fillerSegments.length || !file}
                      >
                        ⏭️ Nächstes Füllwort
                      </button>
                      <button
                        type="button"
                        className={isSupercutActive ? 'player-control-button active' : 'player-control-button'}
                        onClick={() => setIsSupercutActive(!isSupercutActive)}
                        disabled={!fillerSegments.length || !file}
                      >
                        🎧 {isSupercutActive ? 'Supercut beenden' : 'Füllwort-Supercut abspielen'}
                      </button>
                    </div>
                  </div>

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
                    <div className="section-label">Transkript mit Zeitstempeln</div>
                    {file && <audio className="playback" ref={playbackRef} src={playbackUrl} controls />}
                    <div className="transcript-list">
                      {(result.segments || []).map((segment) => (
                        <button className="transcript-segment" type="button" key={`${segment.start}-${segment.end}`} onClick={() => {
                          if (activeSourceUrl.startsWith('http')) {
                            const separator = activeSourceUrl.includes('?') ? '&' : '?'
                            window.open(`${activeSourceUrl}${separator}t=${Math.floor(segment.start)}s`, '_blank', 'noopener,noreferrer')
                          } else if (playbackRef.current) {
                            playbackRef.current.currentTime = segment.start
                            void playbackRef.current.play()
                          }
                        }}>
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
  // Persistent filler counts that survive Web Speech API finalization (which strips filler words like 'äh')
  const finalFillerCountsRef = useRef<Record<string, number>>({})
  // Last interim transcript text to detect new filler words as they appear
  const lastInterimRef = useRef<string>('')

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
      setElapsedSeconds((sec) => sec + 1)
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
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('Dein Browser unterstützt keine Echtzeit-Spracherkennung. Bitte nutze Google Chrome oder MS Edge für das Live Studio.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      void startVisualizer(stream)

      const recognition = new SpeechRecognition()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = 'de-DE'

      recognition.onresult = (event: any) => {
        // Separate final from interim text
        // The Web Speech API (de-DE) strips filler words like 'äh'/'ähm' from FINAL results.
        // We must detect them in INTERIM results and persist the counts ourselves.
        let finalText = ''
        let interimText = ''

        for (let i = 0; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            finalText += event.results[i][0].transcript + ' '
          } else {
            interimText += event.results[i][0].transcript
          }
        }

        // 🔍 DEBUG LOGGING — sichtbar in Browser DevTools (F12 → Console)
        console.log('[LiveStudio] resultIndex:', event.resultIndex, 'isFinal:', event.results[event.resultIndex]?.isFinal)
        console.log('[LiveStudio] interimText:', JSON.stringify(interimText))
        console.log('[LiveStudio] finalText (last 100):', finalText.slice(-100))
        console.log('[LiveStudio] words being searched:', words)

        // Display: final + current interim
        const displayText = finalText + interimText
        setLiveTranscript(displayText)

        // WPM is computed from total word count
        const totalTokens = displayText.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []
        if (totalTokens.length > 0 && elapsedSeconds > 0) {
          const wpm = Math.round((totalTokens.length / elapsedSeconds) * 60)
          setSpeechPace(wpm)
          setWpmHistory((prev) => {
            const next = [...prev, wpm]
            return next.length > 60 ? next.slice(-60) : next
          })
        }

        // Helper: count filler words in any text segment
        const countFillers = (text: string): Record<string, number> => {
          const lower = text.toLowerCase()
          const toks = lower.match(/[\p{L}\p{N}]+/gu) || []
          const result: Record<string, number> = {}
          for (const w of words) {
            const wToks = w.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []
            if (!wToks.length) continue
            let count = 0
            for (let i = 0; i <= toks.length - wToks.length; i++) {
              if (wToks.every((tok, offset) => toks[i + offset] === tok)) count++
            }
            if (count > 0) result[w] = count
          }
          return result
        }

        // When a result is finalized: take the max of (final text counts, last interim counts)
        // and store permanently. This preserves 'äh' counts that the API strips on finalization.
        const hasNewFinal = event.results[event.resultIndex]?.isFinal
        if (hasNewFinal) {
          const finalCounts = countFillers(finalText)
          // Merge: keep the higher count (interim had fillers the final lost)
          for (const w of words) {
            const fromFinal = finalCounts[w] || 0
            const fromInterim = finalFillerCountsRef.current[w] || 0
            finalFillerCountsRef.current[w] = Math.max(fromFinal, fromInterim)
          }
          lastInterimRef.current = ''
        }

        // Detect NEW filler words appearing in the CURRENT interim result
        // (compared to previous interim scan) and immediately add them
        if (interimText && interimText !== lastInterimRef.current) {
          lastInterimRef.current = interimText
          const interimCounts = countFillers(interimText)
          for (const w of words) {
            const fromInterim = interimCounts[w] || 0
            const alreadyPersisted = finalFillerCountsRef.current[w] || 0
            if (fromInterim > alreadyPersisted) {
              finalFillerCountsRef.current[w] = fromInterim
            }
          }
        }

        // Build total counts = persistent (captures interim fillers) + current interim (for live display)
        const interimCounts = countFillers(interimText)
        const totalCounts: Record<string, number> = {}
        for (const w of words) {
          totalCounts[w] = Math.max(finalFillerCountsRef.current[w] || 0, interimCounts[w] || 0)
        }
        const totalFiller = Object.values(totalCounts).reduce((a, b) => a + b, 0)

        console.log('[LiveStudio] interimCounts:', interimCounts)
        console.log('[LiveStudio] finalFillerCountsRef:', { ...finalFillerCountsRef.current })
        console.log('[LiveStudio] totalCounts:', totalCounts, '→ totalFiller:', totalFiller)

        setWordCounts(totalCounts)
        setLiveCount((prev) => {
          if (totalFiller > prev) {
            popCounterAnimation()
            spawnParticles()
          }
          return totalFiller
        })

        const lastWordMatched = words.find((w) => (totalCounts[w] || 0) > (wordCounts[w] || 0))
        if (lastWordMatched) {
          setLastAlert(`Füllwort erkannt: „${lastWordMatched}"! Kurz innehalten & Stimme absenken.`)
        }
      }

      recognition.onerror = (err: any) => {
        console.error('Speech recognition error:', err)
      }

      recognition.onend = () => {
        if (isListening) {
          try { recognition.start() } catch {}
        }
      }

      recognition.start()
      recognitionRef.current = recognition
      setIsListening(true)
      setLastAlert('Live-Erkennung aktiv. Sprich frei ins Mikrofon!')
    } catch (e) {
      console.error('Konnte Mikrofon nicht starten:', e)
    }
  }

  const stopListening = () => {
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
    setLiveTranscript('')
    setLastAlert(null)
    setElapsedSeconds(0)
    setSpeechPace(0)
    setWpmHistory([])
    setIsAmbientAlert(false)
    finalFillerCountsRef.current = {}
    lastInterimRef.current = ''
    particlesRef.current = []
    const ctx = particleCanvasRef.current?.getContext('2d')
    if (ctx && particleCanvasRef.current) ctx.clearRect(0, 0, particleCanvasRef.current.width, particleCanvasRef.current.height)
  }

  return (
    <section className="live-studio-view">
      <div className="live-studio-header">
        <div className="live-studio-header-titles">
          <span className="eyebrow">ECHTZEIT-SPRECHFLUSS-TRAINER</span>
          <h1>🔴 Live Studio — <em>Präsentation live üben</em></h1>
          <p className="intro-copy">Sprich frei ins Mikrofon. Füllwörter werden live gezählt, dein Ton als Wave visualisiert & dein Tempo getracked.</p>
        </div>
        <div className="live-header-status-badge">
          <span className={isListening ? 'live-mic-dot recording' : 'live-mic-dot'} />
          <b>{isListening ? 'LIVE-ERKENNUNG AKTIV' : 'BEREIT'}</b>
        </div>
      </div>

      <div className="live-studio-grid">
        <div className="live-studio-panel left-panel">
          <div className={`live-counter-box${isAmbientAlert ? ' ambient-alert' : ''}`}>
            <img src="/logo.png" alt="ähzähler Logo" className="live-logo-badge" />

            {/* Particle canvas overlay */}
            <div className="particle-canvas-wrap">
              <div className="flip-counter-display">
                <span ref={counterRef} className="flip-counter-number">{String(liveCount).padStart(2, '0')}</span>
              </div>
              <canvas ref={particleCanvasRef} width={200} height={120} className="particle-canvas" />
            </div>

            <div className="audio-visualizer-box" title="Echtzeit-Audio-Waveform deines Mikrofons">
              <div className="wave-label"><span>WAVE-SIGNAL DEINER STIMME</span></div>
              <canvas ref={canvasRef} width={280} height={52} className="audio-visualizer-canvas" />
            </div>

            <div className="live-status-indicator">
              <span className={isListening ? 'live-mic-dot recording' : 'live-mic-dot'} />
              <span>{isListening ? 'Mikrofon aktiv · Stimmsignal wird verarbeitet' : 'Mikrofon im Standby'}</span>
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
              <strong>{speechPace} <span style={{ fontSize: '13px', fontWeight: 400 }}>WPM</span></strong>
            </div>
          </div>

          {/* WPM Rolling Chart */}
          <div className="wpm-chart-box">
            <div className="wpm-chart-label">📈 Sprechtempo-Verlauf (letzte 60 Sek.)</div>
            <canvas ref={wpmCanvasRef} width={460} height={80} className="wpm-chart-canvas" />
            {wpmHistory.length < 2 && (
              <div className="wpm-chart-hint">Sprich ins Mikrofon — der Tempo-Graph erscheint hier in Echtzeit</div>
            )}
          </div>

          <div className="breakdown" style={{ marginTop: '10px' }}>
            {words.map((word) => (
              <div key={word}>
                <b>„{word}"</b>
                <strong>{wordCounts[word] || 0}</strong>
                <span>Treffer</span>
              </div>
            ))}
          </div>

          <div className="live-transcript-box" ref={transcriptBoxRef}>
            <div className="section-label">Live Transkript-Stream</div>
            <p className="transcript-text">{liveTranscript || 'Noch keine Sprache erfasst. Klicke auf „Live-Session starten" und sprich ins Mikrofon.'}</p>
          </div>
        </div>
      </div>
    </section>
  )
}

export default App
