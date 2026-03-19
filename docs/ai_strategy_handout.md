# AI Strategy Handout: Architektur & Logik (Frontend & UX)

Dieses Handout beschreibt die technische Integration und die visuelle Logik der Solana-spezifischen KI-Strategien im **Scalpatron**-Frontend. Es dient als Leitfaden für Entwickler, um das Zusammenspiel zwischen KI-Daten und Benutzererfahrung zu verstehen.

---

## 1. Die drei Kern-Strategien (Solana Optimized)
Das System nutzt spezialisierte UI-Definitionen für drei High-Yield-Strategien:

*   **Solana Pulse Sniper** (Typ: `scalping`)
    *   **Fokus**: Erkennt winzige Preis-Spikes über dem Boden-Median innerhalb von Sekunden.
    *   **Visualisierung**: Blaues Farbschema, `Zap`-Icon, aktive Puls-Animation (`animate-pulse`).
    *   **Effekt**: `shadow-[0_0_12px_rgba(59,130,246,0.3)]` für maximale Präsenz im Grid.

*   **Asymmetric Breakout (Runner)** (Typ: `trend` / `breakout`)
    *   **Fokus**: Identifiziert asymmetrische Risiko-Ratios bei Trenddurchbrüchen.
    *   **Visualisierung**: Oranges Farbschema, `TrendingUp`-Icon.
    *   **Effekt**: `shadow-[0_0_12px_rgba(249,115,22,0.3)]` (Amber-Kupfer-Glow).

*   **Solana V-Shape Dip Buyer** (Typ: `mean_reversion`)
    *   **Fokus**: Nutzt Panikverkäufe für extrem günstige Einstiege bei schnellen Erholungen.
    *   **Visualisierung**: Violettes Farbschema, `ArrowDown`-Icon.
    *   **Effekt**: `shadow-[0_0_12px_rgba(168,85,247,0.3)]` (Magic-Purple-Glow).

---

## 2. Robuste Detektions-Logik
Eine zentrale Erkenntnis der Entwicklung war die Instabilität rein namensbasierter Erkennung. Die aktuelle Logik in `BotChipGrid.tsx` und `App.tsx` nutzt ein redundantes System:

```typescript
const isSniper = sn?.includes("Sniper") || si.toLowerCase().includes("sniper");
const isRunner = sn?.includes("Breakout") || si.toLowerCase().includes("runner");
const isDip    = sn?.includes("Dip Buyer") || si.toLowerCase().includes("dip");
```

*   **`sn` (Strategy Name)**: Greift, wenn die Strategie-Konfiguration bereits vollständig geladen ist.
*   **`si` (Strategy ID)**: Greift sofort bei der Erstellung des Bots (Fallback), da die ID vom Backend (Template-ID) meist sprechende Namen wie `solana-pulse-sniper` enthält.
*   **Vorteil**: Verhindert das "Verschwinden" von Badges während der Initialisierungsphase eines neuen Bots.

---

## 3. Visuelle Komponenten-Hierarchie

### A. BotChipGrid (Dashboard)
Im Grid wird die Strategie nicht nur durch eine Badge, sondern durch das gesamte Header-Element kommuniziert:
1.  **Name-Highlighting**: Der Bot-Name ändert seine Farbe passend zur Strategie (z.B. `text-blue-400`).
2.  **Badge-Halo**: Ein farbiger Ring (`bg-color/10`) umgibt das `StrategyBadge`, um die visuelle Tiefe zu erhöhen.

### B. App Header (Detailansicht)
In der Detailansicht wird ein **Premium Header** verwendet:
*   Ein radialer Gradient (`oklch(from var(--primary) l c h / 0.05)`) im Hintergrund erzeugt eine dezente Tiefenwirkung.
*   Die Strategie-Badge ist hier größer und bietet detaillierte Tooltips via `getStrategyDescription`.

### C. GlobalBotStatsBar
Die oberste Bar nutzt einen **Trend-Kontext-Chip**:
*   **Glassmorphism**: Backdrop-Blur und subtile Border.
*   **Aktivitäts-Indikator**: Eine CSS-Shimmer-Animation (`animate-[shimmer_3s_infinite]`) signalisiert kontinuierliche Performance-Berechnung.

---

## 4. Echtzeit-Feedback & AI-Events
Das Frontend reagiert dynamisch auf KI-Eingriffe via Server-Sent Events (SSE):

*   **`agent_advice`**: Löst den `aiFlash` aus. Ein radialer Glow über dem betroffenen Bot signalisiert dem User: "Die KI hat soeben Parameter angepasst."
*   **Synchronität**: Die Erkennungslogik der Spezial-Strategien ist in allen UI-Fragmenten identisch implementiert (`isSniper`, `isRunner`, `isDip`), um einen flackerfreien Übergang zwischen Grid- und Detailansicht zu gewährleisten.

---

## 5. Implementierungs-Leitfaden für neue Strategien
1.  **Backend-ID**: Die ID im Backend-Template sollte ein Keyword enthalten (z.B. `grid` oder `momentum`).
2.  **Styles**: In `BotChipGrid.tsx` das entsprechende Farbschema und Schatten-Mapping hinzufügen.
3.  **Icons**: In `lib/botUtils.tsx` das passende Lucide-Icon mappen.
4.  **Badges**: Die `isKeyword`-Logik in `StrategyBadge` erweitern.

---
*Dokument Stand: 2026-03-19*
