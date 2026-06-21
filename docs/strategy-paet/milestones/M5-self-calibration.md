# M5 — Selbstkalibrierung (Utility-Funktion ω)

Status: DONE ✓ (2026-06-20)
- recordOutcome() in PAETEngine, setOmega() für Restore
- Delayed check nach 10 Ticks in botInstance.onPriceTick
- Persistenz via getSetting/setSetting (key: paet_omega_${botId})
- ω-Restore beim updateStrategy() Aufruf

## Zu liefern
- ω-Adaption nach SELL-Outcome in `PAETEngine`
- ω-Persistenz (als Teil von `paet_settings` im DB-Bot-Eintrag)
- Fehlalarmquote sichtbar im Advisor-Tab (via `agent_history` oder neues Feld)

## Akzeptanzkriterien
- [ ] Nach 5 aufeinanderfolgenden Fehlalarmen: ω > Startwert (Trigger wird konservativer)
- [ ] Nach 5 aufeinanderfolgenden echten Saves: ω bleibt stabil oder sinkt leicht
- [ ] ω bleibt in [0.5, 5.0] geclampd
- [ ] ω überlebt Bot-Neustart (persistiert in DB)
- [ ] `GET /api/agent/regime-performance` oder neue Endpunkt zeigt PAET-Fehlalarmrate
