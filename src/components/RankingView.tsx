import React, { useState, useMemo } from 'react'
import type { HistoryEntry, Result } from '../App'

interface RankingViewProps {
  history: HistoryEntry[]
  onOpenAnalysis: (entry: HistoryEntry, autoStartSupercut?: boolean) => void
  onGoToAnalysis: () => void
  onDeleteEntry?: (entryId: string) => void
}

type RankingCategory = 'media' | 'speakers'
type RankingSort = 'fillerWords' | 'relativeRate' | 'wpm' | 'pauseCount'

interface MediaRankingItem {
  id: string
  title: string
  source: string
  sourceLabel: string
  createdAt: string
  duration: number
  totalWords: number
  fillerWords: number
  relativeRate: number
  wpm: number
  pauseCount: number
  topWords: Array<{ word: string; count: number }>
  speakerCount: number
  isDemo?: boolean
  entry: HistoryEntry
}

interface SpeakerRankingItem {
  id: string
  speakerName: string
  speakerColor: string
  mediaTitle: string
  mediaId: string
  duration: number
  totalWords: number
  fillerWords: number
  relativeRate: number
  wpm: number
  topWords: Array<{ word: string; count: number }>
  entry: HistoryEntry
}

// Built-in benchmark talks so the leaderboard is lively even before multiple analyses
const DEMO_BENCHMARKS: MediaRankingItem[] = [
  {
    id: 'demo-mrmcd',
    title: 'MRMCD2026 – Veranstaltungsabschluss (Closing Talk)',
    source: 'https://www.youtube.com/watch?v=9DlaEI4Xhgg',
    sourceLabel: 'YouTube · MRMCD2026',
    createdAt: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
    duration: 749,
    totalWords: 2520,
    fillerWords: 51,
    relativeRate: 0.0202,
    wpm: 242,
    pauseCount: 6,
    topWords: [{ word: 'ähm', count: 24 }, { word: 'äh', count: 20 }, { word: 'eigentlich', count: 5 }],
    speakerCount: 2,
    isDemo: true,
    entry: {
      id: 'demo-mrmcd',
      source: 'https://www.youtube.com/watch?v=9DlaEI4Xhgg',
      sourceLabel: 'MRMCD2026 Closing Talk',
      createdAt: new Date().toISOString(),
      title: 'MRMCD2026 – Veranstaltungsabschluss',
      note: 'Demo-Talk',
      tags: ['Konferenz', 'Demo'],
      words: ['äh', 'ähm', 'eigentlich', 'halt', 'sozusagen'],
      result: {
        text: 'Hallo und herzlich willkommen zum Closing der besten MRMCD aller Zeiten.',
        fillerWords: 51,
        baseFillerWords: 51,
        totalWords: 2520,
        relativeRate: 0.0202,
        duration: 749,
        wpm: 242,
        pauseCount: 6,
        counts: { ähm: 24, äh: 20, eigentlich: 5 },
        segments: [],
      }
    }
  },
  {
    id: 'demo-podcast',
    title: 'Tech & AI Podcast #84 – Wie Agenten Code schreiben',
    source: 'https://example.com/podcast-84.mp3',
    sourceLabel: 'Podcast · Episode 84',
    createdAt: new Date(Date.now() - 3600 * 1000 * 72).toISOString(),
    duration: 1240,
    totalWords: 3840,
    fillerWords: 94,
    relativeRate: 0.0245,
    wpm: 195,
    pauseCount: 14,
    topWords: [{ word: 'ähm', count: 48 }, { word: 'quasi', count: 26 }, { word: 'sozusagen', count: 12 }],
    speakerCount: 2,
    isDemo: true,
    entry: {
      id: 'demo-podcast',
      source: 'https://example.com/podcast-84.mp3',
      sourceLabel: 'Tech & AI Podcast #84',
      createdAt: new Date().toISOString(),
      title: 'Tech & AI Podcast #84 – Wie Agenten Code schreiben',
      note: 'Podcast',
      tags: ['Podcast', 'Demo'],
      words: ['äh', 'ähm', 'quasi', 'sozusagen'],
      result: {
        text: 'In dieser Folge sprechen wir über autonome Coding-Agenten und Füllwörter.',
        fillerWords: 94,
        baseFillerWords: 94,
        totalWords: 3840,
        relativeRate: 0.0245,
        duration: 1240,
        wpm: 195,
        pauseCount: 14,
        counts: { ähm: 48, quasi: 26, sozusagen: 12 },
        segments: [],
      }
    }
  },
  {
    id: 'demo-keynote',
    title: 'Developer Summit Keynote – Die Zukunft von Open Source',
    source: 'https://example.com/keynote.mp3',
    sourceLabel: 'Keynote Talk 2026',
    createdAt: new Date(Date.now() - 3600 * 1000 * 120).toISOString(),
    duration: 910,
    totalWords: 3100,
    fillerWords: 29,
    relativeRate: 0.0094,
    wpm: 218,
    pauseCount: 8,
    topWords: [{ word: 'äh', count: 18 }, { word: 'halt', count: 8 }, { word: 'ähm', count: 3 }],
    speakerCount: 1,
    isDemo: true,
    entry: {
      id: 'demo-keynote',
      source: 'https://example.com/keynote.mp3',
      sourceLabel: 'Developer Summit Keynote',
      createdAt: new Date().toISOString(),
      title: 'Developer Summit Keynote – Die Zukunft von Open Source',
      note: 'Keynote',
      tags: ['Keynote', 'Demo'],
      words: ['äh', 'ähm', 'halt'],
      result: {
        text: 'Herzlich willkommen zur diesjährigen Entwicklerkonferenz.',
        fillerWords: 29,
        baseFillerWords: 29,
        totalWords: 3100,
        relativeRate: 0.0094,
        duration: 910,
        wpm: 218,
        pauseCount: 8,
        counts: { äh: 18, halt: 8, ähm: 3 },
        segments: [],
      }
    }
  }
]

export const RankingView: React.FC<RankingViewProps> = ({
  history,
  onOpenAnalysis,
  onGoToAnalysis,
  onDeleteEntry,
}) => {
  const [category, setCategory] = useState<RankingCategory>('media')
  const [sortField, setSortField] = useState<RankingSort>('fillerWords')
  const [searchQuery, setSearchQuery] = useState('')

  // Delete modal state
  const [deleteModalItem, setDeleteModalItem] = useState<{ id: string; title: string; isDemo?: boolean; fillerWords: number } | null>(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteShowPassword, setDeleteShowPassword] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteSuccessMsg, setDeleteSuccessMsg] = useState('')

  // Hidden demo items (stored in localStorage)
  const [hiddenDemoIds, setHiddenDemoIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('aehm_hidden_demo_ranking') || '[]')
    } catch {
      return []
    }
  })

  // 1. Transform History into Media Ranking Items
  const mediaItems = useMemo<MediaRankingItem[]>(() => {
    const fromHistory: MediaRankingItem[] = history.map((entry) => {
      const res = entry.result || ({} as Result)
      const counts = res.counts || {}
      const sortedCounts = Object.entries(counts)
        .map(([word, count]) => ({ word, count: Number(count) }))
        .filter((item) => item.count > 0)
        .sort((a, b) => b.count - a.count)

      const speakersList = res.speakers ? Object.values(res.speakers).filter((s) => s.totalWords > 0) : []

      return {
        id: entry.id,
        title: entry.title || entry.sourceLabel || 'Unbenannte Aufnahme',
        source: entry.source || '',
        sourceLabel: entry.sourceLabel || 'Aufnahme',
        createdAt: entry.createdAt || new Date().toISOString(),
        duration: Number(res.duration || 0),
        totalWords: Number(res.totalWords || 0),
        fillerWords: Number(res.fillerWords || 0),
        relativeRate: Number(res.relativeRate || 0),
        wpm: Number(res.wpm || (res.duration && res.duration > 0 ? Math.round((res.totalWords / (res.duration / 60))) : 0)),
        pauseCount: Number(res.pauseCount || 0),
        topWords: sortedCounts.slice(0, 4),
        speakerCount: speakersList.length || 1,
        entry,
      }
    })

    // If history is small, append benchmarks that aren't duplicate sources and not hidden
    const historySources = new Set(fromHistory.map((h) => h.source))
    const benchmarksToAdd = DEMO_BENCHMARKS
      .filter((b) => !historySources.has(b.source) && !hiddenDemoIds.includes(b.id))

    return [...fromHistory, ...benchmarksToAdd]
  }, [history, hiddenDemoIds])

  // 2. Transform History into Speaker Ranking Items
  const speakerItems = useMemo<SpeakerRankingItem[]>(() => {
    const list: SpeakerRankingItem[] = []

    history.forEach((entry) => {
      const res = entry.result
      if (!res) return

      if (res.speakers && Object.keys(res.speakers).length > 0) {
        Object.values(res.speakers).forEach((sp) => {
          if (sp.totalWords <= 0 && sp.fillerWords <= 0) return
          const sortedCounts = Object.entries(sp.counts || {})
            .map(([word, count]) => ({ word, count: Number(count) }))
            .filter((item) => item.count > 0)
            .sort((a, b) => b.count - a.count)

          list.push({
            id: `${entry.id}-${sp.id}`,
            speakerName: sp.name || 'Sprecher',
            speakerColor: sp.color || '#3b82f6',
            mediaTitle: entry.title || entry.sourceLabel || 'Video',
            mediaId: entry.id,
            duration: Number(sp.duration || 0),
            totalWords: Number(sp.totalWords || 0),
            fillerWords: Number(sp.fillerWords || 0),
            relativeRate: Number(sp.relativeRate ? (sp.relativeRate / (sp.relativeRate > 1 ? 100 : 1)) : 0),
            wpm: Number(sp.wpm || (sp.duration > 0 ? Math.round(sp.totalWords / (sp.duration / 60)) : 0)),
            topWords: sortedCounts.slice(0, 3),
            entry,
          })
        })
      } else if (res.totalWords > 0 || res.fillerWords > 0) {
        // Fallback for single speaker media
        const sortedCounts = Object.entries(res.counts || {})
          .map(([word, count]) => ({ word, count: Number(count) }))
          .filter((item) => item.count > 0)
          .sort((a, b) => b.count - a.count)

        list.push({
          id: `${entry.id}-single`,
          speakerName: 'Haupt-Sprecher',
          speakerColor: '#3b82f6',
          mediaTitle: entry.title || entry.sourceLabel || 'Aufnahme',
          mediaId: entry.id,
          duration: Number(res.duration || 0),
          totalWords: Number(res.totalWords || 0),
          fillerWords: Number(res.fillerWords || 0),
          relativeRate: Number(res.relativeRate || 0),
          wpm: Number(res.wpm || (res.duration && res.duration > 0 ? Math.round(res.totalWords / (res.duration / 60)) : 0)),
          topWords: sortedCounts.slice(0, 3),
          entry,
        })
      }
    })

    // Demo speakers if history is small
    if (list.length < 2) {
      list.push(
        {
          id: 'demo-sp-mrmcd-1',
          speakerName: 'Sprecher 1 (MRMCD)',
          speakerColor: '#3b82f6',
          mediaTitle: 'MRMCD2026 Closing Talk',
          mediaId: 'demo-mrmcd',
          duration: 360,
          totalWords: 1587,
          fillerWords: 33,
          relativeRate: 0.0208,
          wpm: 264,
          topWords: [{ word: 'ähm', count: 16 }, { word: 'äh', count: 11 }, { word: 'eigentlich', count: 4 }],
          entry: DEMO_BENCHMARKS[0].entry,
        },
        {
          id: 'demo-sp-mrmcd-2',
          speakerName: 'Sprecher 2 (MRMCD)',
          speakerColor: '#8b5cf6',
          mediaTitle: 'MRMCD2026 Closing Talk',
          mediaId: 'demo-mrmcd',
          duration: 269,
          totalWords: 933,
          fillerWords: 18,
          relativeRate: 0.0193,
          wpm: 208,
          topWords: [{ word: 'ähm', count: 8 }, { word: 'äh', count: 9 }, { word: 'eigentlich', count: 1 }],
          entry: DEMO_BENCHMARKS[0].entry,
        }
      )
    }

    return list
  }, [history])

  // 3. Filter and Sort Media Items
  const sortedMedia = useMemo(() => {
    let list = [...mediaItems]
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter((m) => m.title.toLowerCase().includes(q) || m.sourceLabel.toLowerCase().includes(q))
    }

    list.sort((a, b) => {
      if (sortField === 'fillerWords') return b.fillerWords - a.fillerWords
      if (sortField === 'relativeRate') return b.relativeRate - a.relativeRate
      if (sortField === 'wpm') return b.wpm - a.wpm
      if (sortField === 'pauseCount') return b.pauseCount - a.pauseCount
      return 0
    })

    return list
  }, [mediaItems, sortField, searchQuery])

  // 4. Filter and Sort Speaker Items
  const sortedSpeakers = useMemo(() => {
    let list = [...speakerItems]
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter((s) => s.speakerName.toLowerCase().includes(q) || s.mediaTitle.toLowerCase().includes(q))
    }

    list.sort((a, b) => {
      if (sortField === 'fillerWords') return b.fillerWords - a.fillerWords
      if (sortField === 'relativeRate') return b.relativeRate - a.relativeRate
      if (sortField === 'wpm') return b.wpm - a.wpm
      return 0
    })

    return list
  }, [speakerItems, sortField, searchQuery])

  // Global Statistics Overview
  const statsOverview = useMemo(() => {
    const totalTalks = mediaItems.length
    const totalFillers = mediaItems.reduce((acc, m) => acc + m.fillerWords, 0)
    const totalWords = mediaItems.reduce((acc, m) => acc + m.totalWords, 0)
    const avgRate = totalWords > 0 ? (totalFillers / totalWords) * 100 : 0
    const topMedia = [...mediaItems].sort((a, b) => b.fillerWords - a.fillerWords)[0]

    return {
      totalTalks,
      totalFillers,
      totalWords,
      avgRate: avgRate.toFixed(1),
      recordHolder: topMedia ? topMedia.title : 'Noch keine Daten',
      recordCount: topMedia ? topMedia.fillerWords : 0,
    }
  }, [mediaItems])

  const formatDuration = (seconds: number) => {
    if (!seconds || seconds <= 0) return '0 min'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs < 10 ? '0' : ''}${secs} min`
  }

  const formatPercent = (rate: number) => {
    const val = rate > 1 ? rate : rate * 100
    return `${val.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`
  }

  const confirmDelete = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!deleteModalItem) return
    if (!deletePassword.trim()) {
      setDeleteError('Bitte Admin-Passwort eingeben.')
      return
    }

    setDeleteLoading(true)
    setDeleteError('')

    try {
      const res = await fetch('/api/admin/verify-delete-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: deletePassword })
      })
      const data = await res.json()

      if (!res.ok || !data.success) {
        setDeleteError(data.error || 'Fehler beim Überprüfen des Passworts.')
        setDeleteLoading(false)
        return
      }

      // Success: Delete entry
      if (deleteModalItem.isDemo) {
        const nextHidden = [...hiddenDemoIds, deleteModalItem.id]
        setHiddenDemoIds(nextHidden)
        try {
          localStorage.setItem('aehm_hidden_demo_ranking', JSON.stringify(nextHidden))
        } catch {}
      } else if (onDeleteEntry) {
        onDeleteEntry(deleteModalItem.id)
      }

      setDeleteSuccessMsg(`„${deleteModalItem.title}“ wurde erfolgreich aus der Rangliste gelöscht.`)
      setDeleteModalItem(null)
      setDeletePassword('')
      setDeleteError('')
      setTimeout(() => setDeleteSuccessMsg(''), 4500)
    } catch {
      setDeleteError('Verbindung zum Server fehlgeschlagen.')
    } finally {
      setDeleteLoading(false)
    }
  }

  // Active items based on selected category
  const topThree = category === 'media' ? sortedMedia.slice(0, 3) : sortedSpeakers.slice(0, 3)

  return (
    <div className="ranking-page-container">
      {/* 🔔 Success Notification Toast */}
      {deleteSuccessMsg && (
        <div className="ranking-success-toast">
          <span className="toast-icon">✅</span>
          <span>{deleteSuccessMsg}</span>
          <button type="button" className="toast-close-btn" onClick={() => setDeleteSuccessMsg('')}>✕</button>
        </div>
      )}

      {/* 🏆 Header & Banner */}
      <section className="ranking-hero-banner">
        <div className="ranking-hero-content">
          <div className="ranking-title-badge">
            <span className="trophy-icon">🏆</span>
            <span>DIE ÄHM-HALL-OF-FAME</span>
          </div>
          <h1>Bestenliste & Füllwort-Ranking</h1>
          <p className="ranking-subtitle">
            Welches Video hat die meisten <em>„ähs“</em> und <em>„ähms“</em>? Wer spricht am flüssigsten? 
            Vergleiche alle analysierten Aufnahmen und finde den ultimativen Füllwort-Rekordhalter!
          </p>
        </div>

        {/* Global Stats Grid */}
        <div className="ranking-stats-grid">
          <div className="ranking-stat-card">
            <span className="stat-label">🎬 Analysierte Medien</span>
            <strong className="stat-value">{statsOverview.totalTalks}</strong>
            <span className="stat-sub">Videos & Audio-Dateien</span>
          </div>
          <div className="ranking-stat-card highlight">
            <span className="stat-label">🔴 Gezählte Füllwörter</span>
            <strong className="stat-value">{statsOverview.totalFillers}</strong>
            <span className="stat-sub">Insgesamt im Leaderboard</span>
          </div>
          <div className="ranking-stat-card">
            <span className="stat-label">📈 Ø Füllwort-Quote</span>
            <strong className="stat-value">{statsOverview.avgRate} %</strong>
            <span className="stat-sub">Bundesweiter Schnitt</span>
          </div>
          <div className="ranking-stat-card gold">
            <span className="stat-label">👑 Goldenes Ähm (Rekord)</span>
            <strong className="stat-value">{statsOverview.recordCount} <small>Füllwörter</small></strong>
            <span className="stat-sub" title={statsOverview.recordHolder}>{statsOverview.recordHolder}</span>
          </div>
        </div>
      </section>

      {/* 🎛️ Filter & Category Controls */}
      <div className="ranking-toolbar-card">
        <div className="ranking-categories-bar">
          <button
            type="button"
            className={category === 'media' ? 'category-tab active' : 'category-tab'}
            onClick={() => setCategory('media')}
          >
            🎬 Videos & Medien ({sortedMedia.length})
          </button>
          <button
            type="button"
            className={category === 'speakers' ? 'category-tab active' : 'category-tab'}
            onClick={() => setCategory('speakers')}
          >
            👥 Sprecher & Hosts ({sortedSpeakers.length})
          </button>
        </div>

        <div className="ranking-controls-row">
          <div className="ranking-search-box">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              placeholder={category === 'media' ? 'Suche nach Video oder Link...' : 'Suche nach Sprecher oder Titel...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="ranking-search-input"
            />
            {searchQuery && (
              <button type="button" className="clear-search-btn" onClick={() => setSearchQuery('')}>×</button>
            )}
          </div>

          <div className="ranking-sort-group">
            <span className="sort-label">Sortieren nach:</span>
            <button
              type="button"
              className={sortField === 'fillerWords' ? 'sort-chip active' : 'sort-chip'}
              onClick={() => setSortField('fillerWords')}
            >
              🔴 Meiste Füllwörter
            </button>
            <button
              type="button"
              className={sortField === 'relativeRate' ? 'sort-chip active' : 'sort-chip'}
              onClick={() => setSortField('relativeRate')}
            >
              📈 Höchste Quote (%)
            </button>
            <button
              type="button"
              className={sortField === 'wpm' ? 'sort-chip active' : 'sort-chip'}
              onClick={() => setSortField('wpm')}
            >
              ⚡ Tempo (WPM)
            </button>
            {category === 'media' && (
              <button
                type="button"
                className={sortField === 'pauseCount' ? 'sort-chip active' : 'sort-chip'}
                onClick={() => setSortField('pauseCount')}
              >
                ⏱️ Meiste Pausen
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 🥇 🥈 🥉 THE PODIUM (Top 3) */}
      {topThree.length > 0 && (
        <section className="ranking-podium-section">
          <div className="podium-section-heading">
            <span className="podium-sparkle">✨</span>
            <h3>DIE TOP 3 SPITZENREITER</h3>
            <span className="podium-sparkle">✨</span>
          </div>

          <div className="podium-container">
            {/* Rank 2 (Silver) */}
            {topThree[1] && (
              <div className="podium-column rank-2">
                <div className="podium-medal silver">🥈 2. Platz</div>
                <div className="podium-card">
                  <button
                    type="button"
                    className="podium-delete-corner-btn"
                    onClick={() => setDeleteModalItem({
                      id: topThree[1].entry.id,
                      title: 'title' in topThree[1] ? topThree[1].title : (topThree[1] as SpeakerRankingItem).speakerName,
                      isDemo: 'isDemo' in topThree[1] && topThree[1].isDemo,
                      fillerWords: topThree[1].fillerWords,
                    })}
                    title="Diesen Eintrag löschen"
                  >
                    🗑️
                  </button>
                  <div className="podium-avatar silver">2</div>
                  <h4 className="podium-item-title" title={'title' in topThree[1] ? topThree[1].title : (topThree[1] as SpeakerRankingItem).speakerName}>
                    {'title' in topThree[1] ? topThree[1].title : (topThree[1] as SpeakerRankingItem).speakerName}
                  </h4>
                  {'mediaTitle' in topThree[1] && (
                    <span className="podium-sub-media">aus {(topThree[1] as SpeakerRankingItem).mediaTitle}</span>
                  )}
                  
                  <div className="podium-main-stat">
                    <span className="main-stat-number">{topThree[1].fillerWords}</span>
                    <span className="main-stat-label">Füllwörter</span>
                  </div>

                  <div className="podium-meta-row">
                    <span>Quote: <strong>{formatPercent(topThree[1].relativeRate)}</strong></span>
                    <span>·</span>
                    <span>Tempo: <strong>{topThree[1].wpm} WPM</strong></span>
                  </div>

                  <div className="podium-top-chips">
                    {topThree[1].topWords.map((tw) => (
                      <span key={tw.word} className="podium-chip">
                        „{tw.word}“ {tw.count}×
                      </span>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="podium-open-btn"
                    onClick={() => onOpenAnalysis(topThree[1].entry)}
                  >
                    🔍 Analyse öffnen
                  </button>
                </div>
                <div className="podium-pedestal silver-pedestal">
                  <span>SILBER</span>
                </div>
              </div>
            )}

            {/* Rank 1 (Gold - Center & Elevated) */}
            {topThree[0] && (
              <div className="podium-column rank-1">
                <div className="podium-crown-badge">👑 SPITZENREITER</div>
                <div className="podium-medal gold">🥇 1. Platz (Gold)</div>
                <div className="podium-card gold-card">
                  <button
                    type="button"
                    className="podium-delete-corner-btn"
                    onClick={() => setDeleteModalItem({
                      id: topThree[0].entry.id,
                      title: 'title' in topThree[0] ? topThree[0].title : (topThree[0] as SpeakerRankingItem).speakerName,
                      isDemo: 'isDemo' in topThree[0] && topThree[0].isDemo,
                      fillerWords: topThree[0].fillerWords,
                    })}
                    title="Diesen Eintrag löschen"
                  >
                    🗑️
                  </button>
                  <div className="podium-avatar gold">1</div>
                  <h4 className="podium-item-title gold-title" title={'title' in topThree[0] ? topThree[0].title : (topThree[0] as SpeakerRankingItem).speakerName}>
                    {'title' in topThree[0] ? topThree[0].title : (topThree[0] as SpeakerRankingItem).speakerName}
                  </h4>
                  {'mediaTitle' in topThree[0] && (
                    <span className="podium-sub-media">aus {(topThree[0] as SpeakerRankingItem).mediaTitle}</span>
                  )}

                  <div className="podium-main-stat gold-stat">
                    <span className="main-stat-number">{topThree[0].fillerWords}</span>
                    <span className="main-stat-label">Füllwörter Rekord</span>
                  </div>

                  <div className="podium-meta-row">
                    <span>Quote: <strong>{formatPercent(topThree[0].relativeRate)}</strong></span>
                    <span>·</span>
                    <span>Tempo: <strong>{topThree[0].wpm} WPM</strong></span>
                    <span>·</span>
                    <span>Dauer: <strong>{formatDuration(topThree[0].duration)}</strong></span>
                  </div>

                  <div className="podium-top-chips">
                    {topThree[0].topWords.map((tw) => (
                      <span key={tw.word} className="podium-chip gold-chip">
                        „{tw.word}“ {tw.count}×
                      </span>
                    ))}
                  </div>

                  <div className="podium-actions-group">
                    <button
                      type="button"
                      className="podium-open-btn primary"
                      onClick={() => onOpenAnalysis(topThree[0].entry)}
                    >
                      🔍 Analyse öffnen
                    </button>
                    <button
                      type="button"
                      className="podium-supercut-btn"
                      onClick={() => onOpenAnalysis(topThree[0].entry, true)}
                      title="Füllwort-Supercut dieses Rekords abspielen"
                    >
                      🎧 Supercut
                    </button>
                  </div>
                </div>
                <div className="podium-pedestal gold-pedestal">
                  <span>GOLD</span>
                </div>
              </div>
            )}

            {/* Rank 3 (Bronze) */}
            {topThree[2] && (
              <div className="podium-column rank-3">
                <div className="podium-medal bronze">🥉 3. Platz</div>
                <div className="podium-card">
                  <button
                    type="button"
                    className="podium-delete-corner-btn"
                    onClick={() => setDeleteModalItem({
                      id: topThree[2].entry.id,
                      title: 'title' in topThree[2] ? topThree[2].title : (topThree[2] as SpeakerRankingItem).speakerName,
                      isDemo: 'isDemo' in topThree[2] && topThree[2].isDemo,
                      fillerWords: topThree[2].fillerWords,
                    })}
                    title="Diesen Eintrag löschen"
                  >
                    🗑️
                  </button>
                  <div className="podium-avatar bronze">3</div>
                  <h4 className="podium-item-title" title={'title' in topThree[2] ? topThree[2].title : (topThree[2] as SpeakerRankingItem).speakerName}>
                    {'title' in topThree[2] ? topThree[2].title : (topThree[2] as SpeakerRankingItem).speakerName}
                  </h4>
                  {'mediaTitle' in topThree[2] && (
                    <span className="podium-sub-media">aus {(topThree[2] as SpeakerRankingItem).mediaTitle}</span>
                  )}

                  <div className="podium-main-stat">
                    <span className="main-stat-number">{topThree[2].fillerWords}</span>
                    <span className="main-stat-label">Füllwörter</span>
                  </div>

                  <div className="podium-meta-row">
                    <span>Quote: <strong>{formatPercent(topThree[2].relativeRate)}</strong></span>
                    <span>·</span>
                    <span>Tempo: <strong>{topThree[2].wpm} WPM</strong></span>
                  </div>

                  <div className="podium-top-chips">
                    {topThree[2].topWords.map((tw) => (
                      <span key={tw.word} className="podium-chip">
                        „{tw.word}“ {tw.count}×
                      </span>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="podium-open-btn"
                    onClick={() => onOpenAnalysis(topThree[2].entry)}
                  >
                    🔍 Analyse öffnen
                  </button>
                </div>
                <div className="podium-pedestal bronze-pedestal">
                  <span>BRONZE</span>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* 📋 Complete Leaderboard Table (Rank 1 to N) */}
      <section className="ranking-table-card">
        <div className="ranking-table-header">
          <div>
            <h3>Gesamte Rangliste ({category === 'media' ? sortedMedia.length : sortedSpeakers.length} Einträge)</h3>
            <p className="ranking-table-sub">Klicke auf eine Zeile oder den Button, um den Talk direkt im Füllwort-Sniper zu analysieren.</p>
          </div>
          <button type="button" className="new-analysis-cta-btn" onClick={onGoToAnalysis}>
            + Neues Video analysieren
          </button>
        </div>

        <div className="ranking-table-responsive-wrap">
          <table className="ranking-main-table">
            <thead>
              <tr>
                <th className="th-rank">Rang</th>
                <th className="th-title">{category === 'media' ? 'Titel & Quelle' : 'Sprecher & Aufnahme'}</th>
                <th className="th-fillers">Füllwörter</th>
                <th className="th-quote">Füllwort-Quote</th>
                <th className="th-wpm">Tempo</th>
                <th className="th-topwords">Häufigste Füllwörter</th>
                <th className="th-actions">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {(category === 'media' ? sortedMedia : sortedSpeakers).map((item, index) => {
                const rank = index + 1
                const isRank1 = rank === 1
                const isRank2 = rank === 2
                const isRank3 = rank === 3

                const title = 'title' in item ? item.title : (item as SpeakerRankingItem).speakerName
                const sub = 'sourceLabel' in item ? item.sourceLabel : `in: ${(item as SpeakerRankingItem).mediaTitle}`
                const isDemo = 'isDemo' in item && item.isDemo

                return (
                  <tr key={item.id} className={isRank1 ? 'rank-row gold-row' : (isRank2 ? 'rank-row silver-row' : (isRank3 ? 'rank-row bronze-row' : 'rank-row'))}>
                    <td className="td-rank">
                      <span className={`rank-number-badge ${isRank1 ? 'gold' : isRank2 ? 'silver' : isRank3 ? 'bronze' : ''}`}>
                        {isRank1 ? '🥇 #1' : isRank2 ? '🥈 #2' : isRank3 ? '🥉 #3' : `#${rank}`}
                      </span>
                    </td>
                    <td className="td-title">
                      <div className="ranking-title-group">
                        <strong className="main-item-title" title={title}>{title}</strong>
                        <div className="ranking-meta-sub">
                          <span className="source-sub-badge">{sub}</span>
                          {'duration' in item && item.duration > 0 && (
                            <span className="duration-sub">⏱️ {formatDuration(item.duration)}</span>
                          )}
                          {'speakerCount' in item && item.speakerCount > 1 && (
                            <span className="speakers-count-badge">👥 {item.speakerCount} Sprecher</span>
                          )}
                          {isDemo && <span className="demo-pill">Benchmark</span>}
                        </div>
                      </div>
                    </td>
                    <td className="td-fillers">
                      <div className="fillers-badge-cell">
                        <span className="fillers-bold-count">{item.fillerWords}</span>
                        <small className="total-words-sub">von {item.totalWords} Wörtern</small>
                      </div>
                    </td>
                    <td className="td-quote">
                      <div className="quote-bar-wrap">
                        <span className="quote-text-val">{formatPercent(item.relativeRate)}</span>
                        <div className="quote-progress-track">
                          <div
                            className="quote-progress-fill"
                            style={{
                              width: `${Math.min(100, Math.max(4, (item.relativeRate > 1 ? item.relativeRate : item.relativeRate * 100) * 12))}%`,
                              background: isRank1 ? '#f59e0b' : (item.relativeRate > 0.03 ? '#ef4444' : '#3b82f6')
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="td-wpm">
                      <span className="wpm-cell-value">{item.wpm} <small>WPM</small></span>
                    </td>
                    <td className="td-topwords">
                      <div className="topwords-chips-cell">
                        {item.topWords.length > 0 ? (
                          item.topWords.map((tw) => (
                            <span key={tw.word} className="mini-topword-chip">
                              „{tw.word}“ {tw.count}×
                            </span>
                          ))
                        ) : (
                          <span className="no-fillers-note">Keine Füllwörter</span>
                        )}
                      </div>
                    </td>
                    <td className="td-actions">
                      <div className="ranking-action-buttons">
                        <button
                          type="button"
                          className="ranking-btn-open"
                          onClick={() => onOpenAnalysis(item.entry)}
                          title="Analyse im Detail ansehen"
                        >
                          🔍 Öffnen
                        </button>
                        <button
                          type="button"
                          className="ranking-btn-supercut"
                          onClick={() => onOpenAnalysis(item.entry, true)}
                          title="Füllwort-Supercut abspielen"
                        >
                          🎧 Supercut
                        </button>
                        <button
                          type="button"
                          className="ranking-btn-delete"
                          onClick={() => setDeleteModalItem({ id: item.entry.id, title, isDemo, fillerWords: item.fillerWords })}
                          title="Eintrag aus Rangliste löschen (Admin-Passwort erforderlich)"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 🔒 Admin Password Deletion Modal Dialog */}
      {deleteModalItem && (
        <div className="ranking-modal-overlay" onClick={() => !deleteLoading && setDeleteModalItem(null)}>
          <div className="ranking-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="ranking-modal-header">
              <div className="ranking-modal-title-row">
                <span className="modal-lock-icon">🔒</span>
                <h3>Eintrag löschen bestätigen</h3>
              </div>
              <button
                type="button"
                className="ranking-modal-close"
                onClick={() => !deleteLoading && setDeleteModalItem(null)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={confirmDelete} className="ranking-modal-body">
              <div className="delete-target-preview">
                <span className="target-label">Ausgewählter Eintrag:</span>
                <strong className="target-title">{deleteModalItem.title}</strong>
                <span className="target-fillers">🔴 {deleteModalItem.fillerWords} Füllwörter</span>
              </div>

              <div className="delete-warning-text">
                ⚠️ Das Löschen eines Eintrags ist <strong>unwiderruflich</strong> und erfordert das Admin-Passwort.
              </div>

              <div className="delete-password-input-group">
                <label htmlFor="admin-delete-pwd" className="input-label">Admin-Passwort:</label>
                <div className="password-field-wrapper">
                  <input
                    id="admin-delete-pwd"
                    type={deleteShowPassword ? 'text' : 'password'}
                    placeholder="Admin-Passwort eingeben..."
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    autoFocus
                    disabled={deleteLoading}
                    className="ranking-password-input"
                  />
                  <button
                    type="button"
                    className="toggle-pwd-btn"
                    onClick={() => setDeleteShowPassword(!deleteShowPassword)}
                    title={deleteShowPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
                  >
                    {deleteShowPassword ? '🙈' : '👁️'}
                  </button>
                </div>
                <small className="ip-lock-subhint">
                  🛡️ <strong>Sicherheits-Schutz:</strong> Nach dem 3. Fehlversuch wird deine IP-Adresse automatisch für 15 Minuten gesperrt.
                </small>
              </div>

              {deleteError && (
                <div className="delete-error-alert" role="alert">
                  <span className="error-icon">🚨</span>
                  <span>{deleteError}</span>
                </div>
              )}

              <div className="ranking-modal-actions">
                <button
                  type="button"
                  className="modal-cancel-btn"
                  onClick={() => setDeleteModalItem(null)}
                  disabled={deleteLoading}
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="modal-delete-btn"
                  disabled={deleteLoading || !deletePassword.trim()}
                >
                  {deleteLoading ? '⏳ Wird geprüft...' : '🗑️ Unwiderruflich löschen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
