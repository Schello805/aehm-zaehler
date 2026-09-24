import React, { useState } from 'react'

interface HelpViewProps {
  onGoToAnalysis: () => void
  onGoToSettings: () => void
  onGoToLive?: () => void
}

interface FaqItem {
  id: string
  question: string
  answer: React.ReactNode
}

export const HelpView: React.FC<HelpViewProps> = ({
  onGoToAnalysis,
  onGoToSettings,
  onGoToLive,
}) => {
  const [openFaq, setOpenFaq] = useState<string | null>('faq-1')

  const toggleFaq = (id: string) => {
    setOpenFaq((prev) => (prev === id ? null : id))
  }

  const faqItems: FaqItem[] = [
    {
      id: 'faq-1',
      question: 'Warum wurde „eh cool“ oder „eh klar“ früher als Füllwort gezählt und jetzt nicht mehr?',
      answer: (
        <p>
          Im umgangssprachlichen Deutsch (besonders im Süden und in Österreich) bedeutet <strong>„eh“</strong> so viel wie <em>„ohnehin“</em> oder <em>„sowieso“</em> (z.&nbsp;B. <em>„das ist eh klar“</em>, <em>„war eh cool“</em>). Es ist damit ein reguläres Bedeutungswort und kein Zögerungslaut. Ähm-Zähler unterscheidet strikt zwischen dem echten Pausenlaut <strong>„äh“</strong> (inklusive Lautdehnungen wie <em>„ähh“</em>, <em>„äääh“</em>) und dem Wort <strong>„eh“</strong>. Nur wenn du <em>„eh“</em> ganz bewusst selbst als individuellen Suchbegriff anlegst, wird es erfasst.
        </p>
      ),
    },
    {
      id: 'faq-2',
      question: 'Welches KI-Modell nutzt die App und warum ist es so schnell?',
      answer: (
        <p>
          Wir setzen auf <strong>faster-whisper</strong>, eine hochoptimierte Re-Implementierung der <strong>OpenAI Whisper</strong>-Architektur mit der <strong>CTranslate2</strong>-Inferenz-Engine und <strong>int8-Quantisierung</strong>. Dadurch läuft die Spracherkennung bis zu 4-mal schneller als herkömmliche Sprachmodelle bei minimalem Speicherbedarf – direkt auf dem CPU-Server oder sogar auf einem Raspberry Pi 5, ohne teure Cloud-Grafikkarten.
        </p>
      ),
    },
    {
      id: 'faq-3',
      question: 'Warum verschlucken normale Transkriptionstools Füllwörter – und wie verhindert der äh-zähler das?',
      answer: (
        <p>
          Die meisten KI-Sprachmodelle sind darauf trainiert, <em>saubere, druckreife Texte</em> zu erzeugen. Sie filtern Fülllaute wie <em>„äh“</em> und <em>„ähm“</em> automatisch heraus. Ähm-Zähler verwendet einen <strong>maßgeschneiderten deutschen Initial-Prompt</strong> und <strong>gezielte Hotword-Injektion</strong> (<em>„Transkribiere absolut wörtlich inklusive aller Füllwörter und Pausenlaute...“</em>). Dadurch wird Whisper angewiesen, jedes Zögern und jeden Denklaut buchstabengetreu auszuschreiben.
        </p>
      ),
    },
    {
      id: 'faq-4',
      question: 'Wie funktioniert die Sprecher-Trennung (Diarisierung) ohne Stimmentraining?',
      answer: (
        <p>
          Ähm-Zähler analysiert das Audiosignal auf Segmentebene über eine <strong>Grundfrequenz-Analyse (F0-Pitch-Schätzung)</strong> im Bereich von 75 bis 380&nbsp;Hz (repräsentativ für menschliche Stimmlagen). Unterscheiden sich die Stimmen in ihrer Tonhöhe oder treten typische Frage-Antwort-Muster auf, weist der Algorithmus die Segmente automatisch <em>Sprecher 1</em> und <em>Sprecher 2</em> zu.
        </p>
      ),
    },
    {
      id: 'faq-5',
      question: 'Was ist der „Sniper-Player“ und wie funktioniert er?',
      answer: (
        <p>
          Weil jedes erkannte Füllwort mit einem <strong>millisekundengenauen Wort-Zeitstempel</strong> (Word-Level Timestamp) verknüpft ist, kannst du mit dem Sniper-Player punktgenau von einem Füllwort zum nächsten springen. Die Wiedergabe startet mit einem leichten Vorlauf von <strong>-0,12 Sekunden</strong>, damit du das Wort im natürlichen Kontext des Satzes sofort hörst.
        </p>
      ),
    },
    {
      id: 'faq-6',
      question: 'Werden meine hochgeladenen Audio-Dateien dauerhaft gespeichert?',
      answer: (
        <p>
          <strong>Nein, absolut nicht.</strong> Hochgeladene Audio-Dateien werden nach Abschluss der Analyse umgehend vom Server gelöscht. Alle Analysedaten und Transkripte verbleiben sicher in deinem lokalen Browser-Speicher (LocalStorage). Es findet keinerlei Training von KI-Modellen mit deinen Daten statt.
        </p>
      ),
    },
    {
      id: 'faq-7',
      question: 'Kann ich eigene Füllwörter wie „quasi“ oder englische Begriffe zählen?',
      answer: (
        <p>
          Ja! Unter <button type="button" className="help-inline-btn" onClick={onGoToSettings}>⚙️ Suchbegriffe</button> kannst du vorgefertigte Presets aktivieren (z.&nbsp;B. <em>„Rhetorik & Weichmacher“</em> oder <em>„Wortdoppelungen“</em>) oder völlig freie Wörter und Redewendungen hinzufügen.
        </p>
      ),
    },
  ]

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <div className="help-view-wrapper">
      {/* Hero Section */}
      <section className="help-hero">
        <div className="help-hero-badge">
          <span className="help-badge-icon">📖</span>
          <span>WISSEN, METHODIK & KI-ARCHITEKTUR</span>
        </div>
        <h1 className="help-hero-title">
          Wie funktioniert der<br /><em>ähm-zähler?</em>
        </h1>
        <p className="help-hero-subtitle">
          Vollständige Transparenz darüber, welche Füllwörter erkannt werden, welche KI-Modelle im Hintergrund arbeiten und wie die millimetergenaue Audio-Erkennung funktioniert.
        </p>

        {/* Quick Navigation Pills */}
        <div className="help-nav-pills">
          <button type="button" className="help-pill-btn" onClick={() => scrollToSection('sec-was')}>
            🎯 Was wird erkannt?
          </button>
          <button type="button" className="help-pill-btn" onClick={() => scrollToSection('sec-wie')}>
            🧠 Wie wird es erkannt?
          </button>
          <button type="button" className="help-pill-btn" onClick={() => scrollToSection('sec-modell')}>
            🤖 Verwendetes KI-Modell
          </button>
          <button type="button" className="help-pill-btn" onClick={() => scrollToSection('sec-features')}>
            ⚡ Besonderheiten & Features
          </button>
          <button type="button" className="help-pill-btn" onClick={() => scrollToSection('sec-privacy')}>
            🔒 Datenschutz & Privatsphäre
          </button>
          <button type="button" className="help-pill-btn" onClick={() => scrollToSection('sec-faq')}>
            ❓ Häufige Fragen (FAQ)
          </button>
        </div>
      </section>

      {/* SECTION 1: Was wird erkannt? */}
      <section id="sec-was" className="help-card-section">
        <div className="help-section-header">
          <span className="help-step-number">01</span>
          <div>
            <h2>Was wird erkannt?</h2>
            <p className="help-section-desc">Die unterschiedlichen Kategorien von Sprech- und Zögerungsmustern im Überblick.</p>
          </div>
        </div>

        <div className="help-grid-3">
          {/* Card 1 */}
          <div className="help-feature-card">
            <div className="help-card-icon-wrap icon-amber">
              <span>🗣️</span>
            </div>
            <h3>Klassische Füll- & Zögerungslaute</h3>
            <p className="help-card-intro">
              Unbewusste Lautäußerungen, wenn das Gehirn nach der nächsten Formulierung sucht:
            </p>
            <ul className="help-token-list">
              <li><span className="token-tag">äh</span> <em>(inkl. ähh, ähhh, äääh)</em></li>
              <li><span className="token-tag">ähm</span> <em>(inkl. ehm, uhm, erm)</em></li>
              <li><span className="token-tag">öh</span> <em>(inkl. öhh, öööh)</em></li>
              <li><span className="token-tag">hm</span> <em>(inkl. hmm, hmmm)</em></li>
              <li><span className="token-tag">mhm</span> <em>(Zustimmungs- & Denkpause)</em></li>
            </ul>
            <div className="help-card-tip">
              <strong>💡 Wichtig:</strong> Wörter wie <em>„eh“</em> (im Sinne von <em>„sowieso“</em>, z.&nbsp;B. <em>„eh cool“</em>) werden bewusst <strong>nicht</strong> gezählt, um Fehlalarme zu vermeiden!
            </div>
          </div>

          {/* Card 2 */}
          <div className="help-feature-card">
            <div className="help-card-icon-wrap icon-blue">
              <span>💬</span>
            </div>
            <h3>Rhetorische Weichmacher & Floskeln</h3>
            <p className="help-card-intro">
              Wörter, die Sätze verwässern, Verbindlichkeit nehmen oder als Füllmaterial dienen:
            </p>
            <ul className="help-token-list">
              <li><span className="token-tag">quasi</span></li>
              <li><span className="token-tag">sozusagen</span></li>
              <li><span className="token-tag">praktisch</span></li>
              <li><span className="token-tag">halt</span></li>
              <li><span className="token-tag">eigentlich</span></li>
              <li><span className="token-tag">irgendwie</span></li>
              <li><span className="token-tag">dingsbums</span></li>
            </ul>
            <p className="help-card-subtext">
              Diese können mit einem Klick über das Preset <strong>„Rhetorik & Weichmacher“</strong> hinzugeschaltet werden.
            </p>
          </div>

          {/* Card 3 */}
          <div className="help-feature-card">
            <div className="help-card-icon-wrap icon-purple">
              <span>🔗</span>
            </div>
            <h3>Mehrwort-Phrasen & Wortdoppelungen</h3>
            <p className="help-card-intro">
              Zusammengesetzte Floskeln und versehentliche Wiederholungen beim Satzstart:
            </p>
            <ul className="help-token-list">
              <li><span className="token-tag">im Grunde</span></li>
              <li><span className="token-tag">im Endeffekt</span></li>
              <li><span className="token-tag">am Ende des Tages</span></li>
              <li><span className="token-tag">ich sag mal</span></li>
              <li><span className="token-tag">ich ich</span>, <span className="token-tag">wir wir</span> <em>(Dopplungen)</em></li>
              <li><span className="token-tag">aber aber</span> <em>(Stottern/Startschleifen)</em></li>
            </ul>
            <div className="help-card-tip">
              Mehrwort-Phrasen werden über ein intelligentes N-Gramm-Sequenzfenster erkannt.
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2: Wie wird es erkannt? */}
      <section id="sec-wie" className="help-card-section">
        <div className="help-section-header">
          <span className="help-step-number">02</span>
          <div>
            <h2>Wie funktioniert die Erkennung?</h2>
            <p className="help-section-desc">Die 5 Phasen der Analyse-Pipeline – von der Audiodatei bis zum millisekundengenauen Treffer.</p>
          </div>
        </div>

        <div className="help-pipeline-list">
          {/* Step 1 */}
          <div className="help-pipeline-item">
            <div className="pipeline-badge">Phase 1</div>
            <div className="pipeline-content">
              <h4>Audio-Aufbereitung & Sampling</h4>
              <p>
                Egal ob MP3, Video (MP4, WebM), YouTube-Stream oder Podcast-RSS: Die Audiospur wird extrahiert und auf <strong>16.000 Hz Mono</strong> konvertiert. Dies ist das optimale Frequenzformat für neuronale Sprachmodelle.
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="help-pipeline-item">
            <div className="pipeline-badge">Phase 2</div>
            <div className="pipeline-content">
              <h4>Neuronale Transkription mit Word-Level Timestamps</h4>
              <p>
                Die KI zerlegt die Rede nicht nur in grobe Absätze, sondern berechnet für <strong>jedes einzelne Wort</strong> einen Start- und Endzeitpunkt auf die Millisekunde genau.
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="help-pipeline-item">
            <div className="pipeline-badge">Phase 3</div>
            <div className="pipeline-content">
              <h4>Wörtlicher Inferenz-Prompt & Hotword-Injektion</h4>
              <p>
                Damit Whisper Füllwörter nicht „wegglättet“ (wie es herkömmliche Diktier-Apps tun), erzwingt unser System über einen wörtlichen Initial-Prompt und Hotwords (<code>äh, ehm, ähm, öh, hm</code>), dass auch kleinste Zögerungen niedergeschrieben werden.
              </p>
            </div>
          </div>

          {/* Step 4 */}
          <div className="help-pipeline-item">
            <div className="pipeline-badge">Phase 4</div>
            <div className="pipeline-content">
              <h4>Phonetische Normalisierung & Lautdehnungen</h4>
              <p>
                Menschen dehnen Füllwörter oft (<em>„äääääh“</em>, <em>„hmmmm“</em>). Ein Reduktions-Algorithmus kollabiert mehrfach wiederholte Buchstaben und vergleicht den Wortstamm mit deiner konfigurierten Füllwortliste.
              </p>
            </div>
          </div>

          {/* Step 5 */}
          <div className="help-pipeline-item">
            <div className="pipeline-badge">Phase 5</div>
            <div className="pipeline-content">
              <h4>Sprecher-Diarisierung & Tonhöhen-Clustering (F0 Pitch)</h4>
              <p>
                Anhand der akustischen Grundfrequenz (Autokorrelation im Frequenzbereich 75–380 Hz) berechnet der Algorithmus die Stimmlage. Werden zwei deutlich getrennte Frequenzcluster erkannt, werden die Füllwörter automatisch <em>Sprecher 1</em> und <em>Sprecher 2</em> zugeordnet.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 3: Verwendetes KI-Modell */}
      <section id="sec-modell" className="help-card-section">
        <div className="help-section-header">
          <span className="help-step-number">03</span>
          <div>
            <h2>Welches KI-Modell verwendet die App?</h2>
            <p className="help-section-desc">Maximale Präzision und Privatsphäre dank lokaler Inferenz.</p>
          </div>
        </div>

        <div className="help-model-box">
          <div className="help-model-header">
            <div className="help-model-chip">
              <span className="model-pulse-dot" />
              <strong>faster-whisper</strong> (OpenAI Whisper Architektur)
            </div>
            <span className="help-model-tag">INT8 Quantisierung · CTranslate2</span>
          </div>

          <div className="help-model-details">
            <div className="model-col">
              <h4>Warum Faster-Whisper?</h4>
              <p>
                <strong>Whisper</strong> von OpenAI gilt weltweit als Goldstandard für mehrsprachige Spracherkennung und Dialektverständnis. <strong>faster-whisper</strong> implementiert diese Architektur in hocheffizientem C++ (CTranslate2).
              </p>
              <ul>
                <li>⚡ <strong>Bis zu 4x schnellere Inferenz</strong> als das Standard-PyTorch-Whisper</li>
                <li>💾 <strong>50% weniger RAM-Bedarf</strong> durch 8-Bit-Quantisierung (int8)</li>
                <li>🍓 <strong>CPU-optimiert</strong>: Läuft flüssig auf Standard-Servern und dem Raspberry Pi 5</li>
              </ul>
            </div>

            <div className="model-col">
              <h4>100% Lokale Ausführung (On-Premise)</h4>
              <p>
                Im Gegensatz zu vielen anderen Web-Apps werden deine Audioaufnahmen <strong>nicht an externe Cloud-APIs</strong> (wie OpenAI API, Google Cloud oder AWS) weitergeleitet.
              </p>
              <ul>
                <li>🔒 <strong>Volle DSGVO-Konformität</strong>: Keine Drittanbieter im Inferenzpfad</li>
                <li>🛡️ <strong>Kein Daten-Training</strong>: Deine Sprache wird niemals zur Modellverbesserung genutzt</li>
                <li>📶 <strong>Keine API-Kosten oder Token-Limits</strong></li>
              </ul>
            </div>
          </div>

          {/* Model Comparison Table */}
          <div className="help-comparison-wrap">
            <h4>Vergleich: Standard-Spracherkennung vs. Ähm-Zähler Pipeline</h4>
            <div className="help-table-scroll">
              <table className="help-table">
                <thead>
                  <tr>
                    <th>Kriterium</th>
                    <th>Normale Diktier-/Transkriptions-Apps</th>
                    <th>ähm-zähler Spezial-Pipeline</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Umgang mit „äh“ / „ähm“</strong></td>
                    <td className="text-muted">Werden automatisch weggeglättet oder ignoriert</td>
                    <td className="text-highlight"><strong>Vollständig erfasst & gezählt</strong> durch Spezial-Prompting</td>
                  </tr>
                  <tr>
                    <td><strong>Zeitstempel</strong></td>
                    <td>Nur grobe Zeitbereiche (Satz-/Absatzebene)</td>
                    <td className="text-highlight"><strong>Millisekundengenau für jedes einzelne Wort</strong></td>
                  </tr>
                  <tr>
                    <td><strong>Interaktives Abspielen</strong></td>
                    <td>Manuelles Suchen in der Zeitleiste</td>
                    <td className="text-highlight"><strong>Sniper-Player mit Sofort-Replay</strong> auf Knopfdruck</td>
                  </tr>
                  <tr>
                    <td><strong>Floskeln & Weichmacher</strong></td>
                    <td>Keine Erkennung rhetorischer Muster</td>
                    <td className="text-highlight"><strong>Mehrwort-Erkennung</strong> („im Grunde“, „quasi“, etc.)</td>
                  </tr>
                  <tr>
                    <td><strong>Sprecher-Diarisierung</strong></td>
                    <td>Oft nur kostenpflichtig in teuren Cloud-Abos</td>
                    <td className="text-highlight"><strong>Integrierte Tonhöhen- & Turn-Erkennung</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 4: Besonderheiten & Features */}
      <section id="sec-features" className="help-card-section">
        <div className="help-section-header">
          <span className="help-step-number">04</span>
          <div>
            <h2>Besonderheiten & smarte Features</h2>
            <p className="help-section-desc">Funktionen, die den ähm-zähler einzigartig machen.</p>
          </div>
        </div>

        <div className="help-grid-3">
          <div className="help-feature-card">
            <div className="help-card-icon-wrap icon-red">
              <span>🎯</span>
            </div>
            <h3>Sniper-Player & Audio-Scrubber</h3>
            <p>
              Höre dir jedes Füllwort einzeln an. Mit den Vor- und Zurück-Buttons oder den Tastaturkürzeln springst du direkt von Treffer zu Treffer.
            </p>
            <div className="help-badge-note">Offset: -0,12 Sekunden Vorlauf</div>
          </div>

          <div className="help-feature-card">
            <div className="help-card-icon-wrap icon-green">
              <span>🌐</span>
            </div>
            <h3>Multi-Quellen & Spotify-Resolver</h3>
            <p>
              Unterstützt lokale Audio-/Videodateien, YouTube-Links, Podcast-RSS-Feeds und sogar Spotify-Episoden (automatischer RSS-Abgleich).
            </p>
            <div className="help-badge-note">Kein manuelles Konvertieren nötig</div>
          </div>

          <div className="help-feature-card">
            <div className="help-card-icon-wrap icon-purple">
              <span>🔴</span>
            </div>
            <h3>Live Studio & Sprechtrainer</h3>
            <p>
              Übe Präsentationen live im Browser mit deinem Mikrofon. Erhalte Live-Feedback über Füllwörter, Sprechtempo und Füllwortquote in Echtzeit.
            </p>
            <div className="help-badge-note">Ideal für Vortragsvorbereitung</div>
          </div>

          <div className="help-feature-card">
            <div className="help-card-icon-wrap icon-blue">
              <span>⏱️</span>
            </div>
            <h3>WPM & Sprechtempo-Tacho</h3>
            <p>
              Misst deine Wörter pro Minute (WPM) pro Segment. Zeigt visuell an, ob du zu schnell (über 160 WPM) oder optimal (120–150 WPM) sprichst.
            </p>
            <div className="help-badge-note">Inkl. Pausen-Erkennung (&gt; 1,5s)</div>
          </div>

          <div className="help-feature-card">
            <div className="help-card-icon-wrap icon-amber">
              <span>🏆</span>
            </div>
            <h3>Hall of Fame & Ähm-Ranking</h3>
            <p>
              Vergleiche deine Episoden und Talks in der Rangliste: Wer hat die sauberste Rede? Wer hält den Rekord bei Füllwörtern?
            </p>
            <div className="help-badge-note">Filter nach Quelle & Sprechern</div>
          </div>

          <div className="help-feature-card">
            <div className="help-card-icon-wrap icon-gray">
              <span>🍓</span>
            </div>
            <h3>Open Source & Self-Hostbar</h3>
            <p>
              Komplett quelloffen auf GitHub. Kann auf eigener Hardware oder Raspberry Pi 5 mit einem einzigen Befehl gehostet werden.
            </p>
            <div className="help-badge-note">ARM64 & x86_64 Support</div>
          </div>
        </div>
      </section>

      {/* SECTION 5: Datenschutz */}
      <section id="sec-privacy" className="help-card-section">
        <div className="help-section-header">
          <span className="help-step-number">05</span>
          <div>
            <h2>Datenschutz & Privatsphäre</h2>
            <p className="help-section-desc">Sicherheit hat bei Sprach- und Tondaten oberste Priorität.</p>
          </div>
        </div>

        <div className="help-privacy-grid">
          <div className="privacy-item">
            <span className="privacy-icon">🗑️</span>
            <div>
              <strong>Automatische Bereinigung</strong>
              <p>Temporäre Upload-Dateien werden nach Abschluss der Analyse sofort und unwiderruflich vom Server gelöscht.</p>
            </div>
          </div>
          <div className="privacy-item">
            <span className="privacy-icon">🚫</span>
            <div>
              <strong>Kein KI-Training mit deinen Daten</strong>
              <p>Deine Sprachaufnahmen werden zu keinem Zeitpunkt gespeichert oder für das Weiter-Training von Modellen genutzt.</p>
            </div>
          </div>
          <div className="privacy-item">
            <span className="privacy-icon">🛡️</span>
            <div>
              <strong>DSGVO-konform ohne Tracking-Cookies</strong>
              <p>Keine Tracking-Cookies, keine Werbenetzwerke, keine Weitergabe an Dritte. Die Analyse bleibt deine Privatsache.</p>
            </div>
          </div>
          <div className="privacy-item">
            <span className="privacy-icon">💻</span>
            <div>
              <strong>Lokal im Browser gespeichert</strong>
              <p>Deine Historie und Analyseergebnisse werden in deinem Browser (LocalStorage) gesichert und können jederzeit gelöscht werden.</p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 6: FAQ */}
      <section id="sec-faq" className="help-card-section">
        <div className="help-section-header">
          <span className="help-step-number">06</span>
          <div>
            <h2>Häufige Fragen (FAQ)</h2>
            <p className="help-section-desc">Antworten auf die wichtigsten Fragen zur Nutzung und Erkennungslogik.</p>
          </div>
        </div>

        <div className="help-accordion-list">
          {faqItems.map((item) => {
            const isOpen = openFaq === item.id
            return (
              <div key={item.id} className={`help-accordion-item ${isOpen ? 'open' : ''}`}>
                <button
                  type="button"
                  className="help-accordion-trigger"
                  onClick={() => toggleFaq(item.id)}
                  aria-expanded={isOpen}
                >
                  <span className="help-faq-q">{item.question}</span>
                  <span className="help-faq-arrow">{isOpen ? '−' : '+'}</span>
                </button>
                {isOpen && (
                  <div className="help-accordion-body">
                    {item.answer}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* Bottom Call to Action */}
      <section className="help-cta-section">
        <div className="help-cta-card">
          <h2>Bereit für deine nächste Analyse?</h2>
          <p>Lade jetzt eine Aufnahme hoch oder passe deine Suchbegriffe individuell an.</p>
          <div className="help-cta-buttons">
            <button type="button" className="btn-primary" onClick={onGoToAnalysis}>
              📊 Zur Füllwort-Analyse
            </button>
            <button type="button" className="btn-secondary" onClick={onGoToSettings}>
              ⚙️ Suchbegriffe anpassen
            </button>
            {onGoToLive && (
              <button type="button" className="btn-secondary" onClick={onGoToLive}>
                🔴 Live Studio starten
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
