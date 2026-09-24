import { useEffect } from 'react'

export type LegalTab = 'impressum' | 'datenschutz'

interface LegalModalProps {
  tab: LegalTab
  setTab: (tab: LegalTab) => void
  onClose: () => void
}

export function LegalModal({ tab, setTab, onClose }: LegalModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="legal-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="legal-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="legal-modal-header">
          <div className="legal-modal-tabs">
            <button
              type="button"
              className={`legal-modal-tab-btn ${tab === 'impressum' ? 'active' : ''}`}
              onClick={() => setTab('impressum')}
            >
              ⚖️ Impressum
            </button>
            <button
              type="button"
              className={`legal-modal-tab-btn ${tab === 'datenschutz' ? 'active' : ''}`}
              onClick={() => setTab('datenschutz')}
            >
              🔒 Datenschutz
            </button>
          </div>
          <button
            type="button"
            className="legal-modal-close-btn"
            onClick={onClose}
            title="Schließen (Esc)"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>

        <div className="legal-modal-body">
          {tab === 'impressum' ? (
            <div className="legal-content">
              <h2>Impressum</h2>
              <p className="legal-subline">Angaben gemäß § 5 Digitale-Dienste-Gesetz (DDG)</p>

              <section className="legal-section">
                <h3>Diensteanbieter</h3>
                <p>
                  <strong>Michael Schellenberger</strong><br />
                  Ziegeleistraße 32<br />
                  91572 Bechhofen<br />
                  Deutschland
                </p>
              </section>

              <section className="legal-section">
                <h3>Kontakt</h3>
                <p>
                  Telefon: <a href="tel:098229899386">09822 9899386</a><br />
                  E-Mail: <a href="mailto:info@schellenberger.biz">info@schellenberger.biz</a>
                </p>
              </section>

              <section className="legal-section">
                <h3>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h3>
                <p>
                  Michael Schellenberger<br />
                  Ziegeleistraße 32<br />
                  91572 Bechhofen
                </p>
              </section>

              <section className="legal-section">
                <h3>EU-Streitschlichtung</h3>
                <p>
                  Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:{' '}
                  <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer">
                    https://ec.europa.eu/consumers/odr/
                  </a>.<br />
                  Unsere E-Mail-Adresse finden Sie oben im Impressum.
                </p>
              </section>

              <section className="legal-section">
                <h3>Verbraucherstreitbeilegung / Universalschlichtungsstelle</h3>
                <p>
                  Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.
                </p>
              </section>

              <section className="legal-section">
                <h3>Haftung für Inhalte</h3>
                <p>
                  Als Diensteanbieter sind wir gemäß § 7 Abs. 1 DDG für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 DDG sind wir als Diensteanbieter jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen. Verpflichtungen zur Entfernung oder Sperrung der Nutzung von Informationen nach den allgemeinen Gesetzen bleiben hiervon unberührt.
                </p>
              </section>

              <section className="legal-section">
                <h3>Haftung für Links</h3>
                <p>
                  Unser Angebot enthält Links zu externen Websites Dritter (z. B. YouTube, Spotify), auf deren Inhalte wir keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der Seiten verantwortlich.
                </p>
              </section>

              <section className="legal-section">
                <h3>Urheberrecht</h3>
                <p>
                  Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen Zustimmung des jeweiligen Autors bzw. Erstellers.
                </p>
              </section>
            </div>
          ) : (
            <div className="legal-content">
              <h2>Datenschutzerklärung</h2>
              <p className="legal-subline">Informationen zur Verarbeitung personenbezogener Daten gemäß Art. 13 & 14 DSGVO</p>

              <section className="legal-section">
                <h3>1. Datenschutz auf einen Blick</h3>
                <p>
                  Wir freuen uns über Ihr Interesse an unserer Anwendung <strong>ähm-zähler</strong>. Der Schutz Ihrer persönlichen Daten ist uns ein wichtiges Anliegen. Nachfolgend informieren wir Sie über Art, Umfang und Zweck der Erhebung und Verwendung Ihrer Daten bei der Nutzung unserer Dienste.
                </p>
              </section>

              <section className="legal-section">
                <h3>2. Verantwortliche Stelle</h3>
                <p>
                  Verantwortlich für die Datenverarbeitung auf dieser Website ist:<br /><br />
                  <strong>Michael Schellenberger</strong><br />
                  Ziegeleistraße 32<br />
                  91572 Bechhofen<br />
                  Telefon: <a href="tel:098229899386">09822 9899386</a><br />
                  E-Mail: <a href="mailto:info@schellenberger.biz">info@schellenberger.biz</a>
                </p>
              </section>

              <section className="legal-section">
                <h3>3. Datenverarbeitung bei der Analyse von Audio- und Videodateien</h3>
                <p>
                  <strong>Zweck der Verarbeitung:</strong> Der Kerndienst dieser Web-App dient der automatischen Erkennung, Zählung und zeitlichen Markierung von Füllwörtern (wie „äh“, „ähm“, „quasi“, „sozusagen“) sowie der Erstellung von Transkripten und Sprechfluss-Statistiken.
                </p>
                <p>
                  <strong>Verarbeitung bei Datei-Uploads & Medien-Links:</strong> Wenn Sie eine Audiodatei hochladen oder eine URL (z. B. YouTube oder Spotify) zur Analyse eingeben, wird die Tonspur auf unserem Server ausschließlich zur KI-basierten Spracherkennung (Whisper) verarbeitet. Nach Abschluss der Transkription und Auswertung werden sämtliche Zwischendateien im temporären Verzeichnis des Servers automatisch gelöscht.
                </p>
                <p>
                  <strong>Kein KI-Training & Keine Weitergabe:</strong> Ihre Audioaufnahmen, Transkripte und Auswertungen werden <u>zu keinem Zeitpunkt</u> zum Trainieren von KI-Modellen verwendet und niemals an Werbetreibende oder unbefugte Dritte weitergegeben oder verkauft.
                </p>
              </section>

              <section className="legal-section">
                <h3>4. Live Studio & Mikrofonzugriff</h3>
                <p>
                  Das Live Studio ermöglicht das freie Sprechtraining mit Echtzeit-Zählung über Ihr Mikrofon:
                </p>
                <ul>
                  <li>
                    <strong>Einwilligung (Art. 6 Abs. 1 lit. a DSGVO):</strong> Der Zugriff auf Ihr Mikrofon erfolgt erst, nachdem Sie dem Browser ausdrücklich die Erlaubnis hierzu erteilt haben. Sie können diese Berechtigung jederzeit in Ihren Browser-Einstellungen widerrufen.
                  </li>
                  <li>
                    <strong>Lokale Echtzeit-Erkennung:</strong> Die Live-Erkennung während des Sprechens erfolgt lokal im Browser über die Web Speech API. Die Sprachaufzeichnung verbleibt im lokalen Arbeitsspeicher Ihres Endgeräts.
                  </li>
                  <li>
                    <strong>Serverseitige Nachbereitung:</strong> Nur wenn Sie explizit eine Nachbearbeitung mit Whisper KI oder einen MP3-Download anfordern, wird die aufgenommene Audiodatei zur Konvertierung/Transkription an den Server gesendet und nach der Bearbeitung sofort aus dem temporären Speicher gelöscht.
                  </li>
                </ul>
              </section>

              <section className="legal-section">
                <h3>5. Lokale Speicherung (localStorage)</h3>
                <p>
                  Diese Website verwendet <strong>keine Werbe-Cookies</strong>, keine Marketing-Pixel und keine Werbenetzwerke (wie Google Ads oder Meta).
                </p>
                <p>
                  Zur Gewährleistung der Grundfunktionen nutzen wir den lokalen Speicher Ihres Browsers (<code>localStorage</code> gemäß Art. 6 Abs. 1 lit. f DSGVO):
                </p>
                <ul>
                  <li>Speicherung Ihres bevorzugten Farbschemas (Dark Mode / Light Mode)</li>
                  <li>Speicherung Ihrer individuellen Füllwort-Suchbegriffe</li>
                  <li>Lokale Speicherung Ihrer vergangenen Analyse-Historie (verbleibt ausschließlich auf Ihrem Gerät)</li>
                </ul>
              </section>

              <section className="legal-section">
                <h3>6. Web-Analyse mit selbst gehostetem Matomo</h3>
                <p>
                  Wir nutzen auf dieser Website die datenschutzfreundliche Open-Source-Software <strong>Matomo</strong> zur statistischen Reichweitenmessung und kontinuierlichen Verbesserung unserer Webanwendung.
                </p>
                <p>
                  <strong>Selbst gehostet auf eigenem Server:</strong> Die Software wird vollständig auf unserer eigenen Serverinfrastruktur (<code>https://analytics.schellenberger.biz/</code>) betrieben. Es findet <u>keine Übermittlung</u> an Dritte oder externe Cloud-Dienste statt. Sämtliche Analysedaten verbleiben vollständig in unserer Kontrolle.
                </p>
                <p>
                  <strong>IP-Anonymisierung:</strong> Vor der Speicherung wird Ihre IP-Adresse durch Maskierung der letzten Oktette anonymisiert, sodass kein Personenbezug herstellbar ist.
                </p>
                <p>
                  <strong>Rechtsgrundlage:</strong> Die Verarbeitung erfolgt auf Grundlage unseres berechtigten Interesses an der bedarfsgerechten Optimierung und Reichweitenanalyse unseres Angebots gemäß Art. 6 Abs. 1 lit. f DSGVO.
                </p>
                <p>
                  <strong>Do Not Track:</strong> Wenn Sie in Ihrem Browser die „Do Not Track“-Funktion (DNT) aktiviert haben, wird Ihr Besuch automatisch nicht erfasst.
                </p>
              </section>

              <section className="legal-section">
                <h3>7. Server-Log-Dateien</h3>
                <p>
                  Der Provider dieser Website erhebt und speichert automatisch Daten in sogenannten Server-Log-Dateien, die Ihr Browser automatisch an uns übermittelt:
                </p>
                <ul>
                  <li>Browsertyp und Browserversion</li>
                  <li>Verwendetes Betriebssystem</li>
                  <li>Referrer URL (zuvor besuchte Seite)</li>
                  <li>Hostname des zugreifenden Rechners / IP-Adresse</li>
                  <li>Datum und Uhrzeit der Serveranfrage</li>
                </ul>
                <p>
                  Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse liegt in der Gewährleistung eines sicheren, stabilen und fehlerfreien Betriebs unseres Dienstes. Eine Zusammenführung dieser Daten mit anderen Datenquellen wird nicht vorgenommen.
                </p>
              </section>

              <section className="legal-section">
                <h3>8. Externe Schnittstellen (Spotify & YouTube)</h3>
                <p>
                  Wenn Sie freiwillig Links zu Spotify-Podcasts oder YouTube-Videos zur Analyse übermitteln, ruft unser Server öffentlich verfügbare Metadaten (Titel, Dauer, Bild-Vorschau) über die offiziellen Schnittstellen (Spotify Web API bzw. oEmbed/yt-dlp) ab, um das Ergebnis darzustellen.
                </p>
              </section>

              <section className="legal-section">
                <h3>9. Ihre Rechte als betroffene Person</h3>
                <p>
                  Sie haben nach der Datenschutz-Grundverordnung (DSGVO) folgende Rechte gegenüber der verantwortlichen Stelle:
                </p>
                <ul>
                  <li><strong>Auskunftsrecht (Art. 15 DSGVO):</strong> Sie können Auskunft über Ihre von uns verarbeiteten personenbezogenen Daten verlangen.</li>
                  <li><strong>Recht auf Berichtigung (Art. 16 DSGVO):</strong> Sie haben das Recht auf Berichtigung unrichtiger Daten.</li>
                  <li><strong>Recht auf Löschung (Art. 17 DSGVO):</strong> Sie können die unverzügliche Löschung Ihrer Daten verlangen.</li>
                  <li><strong>Recht auf Einschränkung der Verarbeitung (Art. 18 DSGVO):</strong> Sie können die Einschränkung der Verarbeitung Ihrer Daten verlangen.</li>
                  <li><strong>Recht auf Datenübertragbarkeit (Art. 20 DSGVO):</strong> Sie haben das Recht, Ihre Daten in einem strukturierten, gängigen Format zu erhalten.</li>
                  <li><strong>Widerspruchsrecht (Art. 21 DSGVO):</strong> Sie können der Verarbeitung Ihrer personenbezogenen Daten jederzeit widersprechen.</li>
                </ul>
                <p>
                  Zur Ausübung Ihrer Rechte genügt eine formlose Mitteilung per E-Mail an:{' '}
                  <a href="mailto:info@schellenberger.biz">info@schellenberger.biz</a>
                </p>
              </section>

              <section className="legal-section">
                <h3>9. Beschwerderecht bei der Aufsichtsbehörde</h3>
                <p>
                  Im Falle datenschutzrechtlicher Verstöße steht Ihnen ein Beschwerderecht bei einer zuständigen Datenschutzaufsichtsbehörde zu. Die für uns zuständige Landesdatenschutzbehörde ist:
                </p>
                <p>
                  <strong>Bayerisches Landesamt für Datenschutzaufsicht (BayLDA)</strong><br />
                  Promenade 18, 91522 Ansbach<br />
                  Website:{' '}
                  <a href="https://www.lda.bayern.de" target="_blank" rel="noopener noreferrer">
                    https://www.lda.bayern.de
                  </a>
                </p>
              </section>
            </div>
          )}
        </div>

        <div className="legal-modal-footer">
          <button type="button" className="legal-modal-dismiss-btn" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  )
}
