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

const getMinuteBuckets = (result: Result) => {
  const bucketCount = Math.max(1, Math.ceil(result.duration / 60))
  const segments = result.segments || []
  return Array.from({ length: bucketCount }, (_, index) => {
    const fillerWords = segments
      .filter((segment) => Math.floor(segment.start / 60) === index)
      .reduce((sum, segment) => sum + Object.values(segment.counts).reduce((segmentSum, count) => segmentSum + count, 0), 0)
    return { minute: index + 1, fillerWords }
  })
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
  const [view, setView] = useState<'analyse' | 'settings'>('analyse')
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const playbackRef = useRef<HTMLAudioElement>(null)
  const analysisControllerRef = useRef<AbortController | null>(null)
  const playbackUrl = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file])

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
    if (!file && !url) {
      setMediaDurationSeconds(null)
      setProgress((current) => ({ ...current, remainingSeconds: defaultEstimatedAnalysisSeconds }))
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
          <span className="brand-mark">ä</span>
          <span>ähzähler</span>
        </button>
        <div className="nav-actions">
          <button className={view === 'analyse' ? 'nav-link active' : 'nav-link'} onClick={() => setView('analyse')} type="button">Analyse</button>
          <button className={view === 'settings' ? 'nav-link active' : 'nav-link'} onClick={() => setView('settings')} type="button">Settings</button>
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
                    <strong>{sourceLabel}</strong>
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
                        <b>„{word}“</b>
                        <strong>{result.counts[word] || 0}</strong>
                        <span>Treffer</span>
                      </div>
                    ))}
                  </div>

                  <div className="density-card">
                    <div className="section-label">Füllwörter pro Minute</div>
                    <div className="density-chart" aria-label="Füllwörter pro Minute">
                      {getMinuteBuckets(result).map((bucket) => (
                        <div className="density-column" key={bucket.minute} title={`${bucket.minute}. Minute: ${bucket.fillerWords} Füllwörter`}>
                          <div className="density-bar" style={{ height: `${Math.max(8, Math.min(100, bucket.fillerWords * 12))}%` }} />
                          <span>{bucket.minute}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="transcript-card">
                    <div className="section-label">Transkript mit Zeitstempeln</div>
                    {file && <audio className="playback" ref={playbackRef} src={playbackUrl} controls />}
                    <div className="transcript-list">
                      {(result.segments || []).map((segment) => (
                        <button className="transcript-segment" type="button" key={`${segment.start}-${segment.end}`} onClick={() => {
                          if (sourceLabel.startsWith('http')) {
                            const separator = sourceLabel.includes('?') ? '&' : '?'
                            window.open(`${sourceLabel}${separator}t=${Math.floor(segment.start)}s`, '_blank', 'noopener,noreferrer')
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

export default App
