# ADR-002: Live-Mode â€“ WALLET_PRIVATE_KEY obligatorisch (kein Auto-Generate)

**Datum:** 18. Juni 2026
**Status:** Akzeptiert
**Bereich:** Wallet

---

## Kontext

Wallet-Loading via `loadOrCreateKeypair()` in `src/wallet.ts:22-32`. Die Funktion
generiert automatisch ein neues Keypair und schreibt es in `.env`, wenn
`WALLET_PRIVATE_KEY` leer ist. Diese Logik lÃ¤uft auch im Live-Trading-Pfad
(`Trader.initLiveMode()` â†’ `src/trader.ts:81-86`).

## Problem

Im **Live-Mode** wÃ¼rde ein leerer `WALLET_PRIVATE_KEY` dazu fÃ¼hren, dass der Bot
*stillschweigend* ein neues, fremdes Keypair erzeugt und ab diesem mit echter Wallet
tradet. Folgen:

- Trading von einer unerwarteten, leeren Wallet (User denkt, seine Wallet sei aktiv).
- Falls der User spÃ¤ter doch seinen echten Key setzt, laufen Trades weiter von der
  generierten Wallet â†’ Geld bleibt dort.
- Kein Fail-Fast; Fehler wird erst bei `syncBalances()`/fehlgeschlagenem Swap sichtbar.

Auto-Generate ist fÃ¼r Devnet/Test-Skripte (`src/wallet.ts` als CLI) bequem, im
Live-Trading-Pfad aber ein **Geld-Sicherheitsrisiko**.

## Optionen

### Option 1: Auto-Generate nur im CLI/Paper, Live wirft (gewÃ¤hlt)
- âœ… Fail-Fast, keine unerwartete Wallet im Live-Pfad.
- âœ… CLI-Komfort (`npx tsx src/wallet.ts`) bleibt erhalten.
- âŒ Leichte Code-Aufsplittung erforderlich.

### Option 2: Auto-Generate komplett verbieten
- âœ… Maximale Sicherheit/Explizitheit.
- âŒ Bricht den Devnet-Onboarding-Flow.

### Option 3: Status Quo belassen
- âŒ BehÃ¤lt das Geld-Risiko unbegrenzt.

## Entscheidung

`loadOrCreateKeypair()` erhÃ¤lt einen Parameter `mode: 'live' | 'dev'`.
Im Modus `live` wird bei fehlendem Key **hart fehlschgeschlagen** (`throw`).
`Trader.initLiveMode()` nutzt `loadOrCreateKeypair('live')`, das CLI `src/wallet.ts`
nutzt weiterhin den generierenden Default-Pfad.

### BegrÃ¼ndung

Fail-Fast ist bei geldberÃ¼hrenden Pfaden nicht verhandelbar; Devnet-Komfort bleibt
durch den Modus-Parameter erhalten.

## Konsequenzen

### Positiv
- âœ… Kein versehentliches Live-Trading mit fremder Wallet.
- âœ… Klares, explizites Setup fÃ¼r Produktion.

### Negativ / Risiken
- âš ï¸ Live-Bot startet nicht mehr, bis Key konfiguriert ist (gewÃ¼nschtes Verhalten).

### Trade-offs
- Komfort (Devnet) vs. Sicherheit (Live).

## Validierung

- Unit-Test: `loadOrCreateKeypair('live')` ohne Key â†’ wirft, erzeugt keine Datei.
- Integration: Live-Bot-Start ohne Key bricht ab; `.env` unverÃ¤ndert.
- Manuelles Devnet-CLI bleibt funktionsfÃ¤hig.

## Implementierungs-Notizen

- Betroffen: `src/wallet.ts:22-32`, `src/trader.ts:81-86`, ggf. `src/wallet.ts:58` (CLI).
- Kein Breaking Change fÃ¼r bestehende Live-Setups mit gesetztem Key.
- Fehlermeldung benennt `.env` und `WALLET_PRIVATE_KEY` explizit.

## Beziehungen

- Siehe auch: ADR-008 (Globales Wallet-Lock), ADR-009 (Tx-Verifikation).
