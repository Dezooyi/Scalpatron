# M4 — Typ-System & Integration

Status: DONE ✓ (2026-06-20, alle bestehenden Tests bestanden, PAET-Template aktiv)

## Zu liefern
- `strategyTypes.ts`: `'paet'` in `StrategyType`, `PaetSettings` Interface, `paet_settings?` in `StrategyConfig`
- `strategyEngine.ts`: PAET-Branch in `constructor`, `updateConfig`, `reset`, `analyze`
- `src/strategyTemplates/paet.json`: Vollständiges Template

## Akzeptanzkriterien
- [ ] `POST /api/bots` mit `strategy_type: 'paet'` schlägt nicht fehl
- [ ] `GET /api/strategies/templates` enthält PAET-Template
- [ ] Bot startet ohne Fehler und gibt HOLD zurück während Warmup
- [ ] TypeScript kompiliert ohne Fehler (`npm run build` in frontend, backend `tsx` ohne Typ-Errors)
