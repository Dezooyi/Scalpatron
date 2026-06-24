import Database from 'better-sqlite3';
const db = new Database('data/scalpatron.db');
const rows = db.prepare(`SELECT timestamp, regime, confidence, reason, aggressivenessAdvice, applied, adjustedSettings, outcomeTradeCount, outcomeWins, outcomeTotalPnl
FROM agent_history WHERE botId = ? ORDER BY timestamp ASC`).all('7152caca-a4f7-4bc6-8349-fa0b4e9c31c7');
console.log('Total advice:', rows.length);
console.log('---');
for (const r of rows) {
  const s = JSON.parse(r.adjustedSettings);
  console.log(`${new Date(r.timestamp).toISOString()} | conf=${(r.confidence*100).toFixed(0)}% | applied=${r.applied} | reg=${r.regime}`);
  console.log(`  reason: ${r.reason}`);
  console.log(`  settings: ${JSON.stringify(s)}`);
  console.log(`  outcome: trades=${r.outcomeTradeCount} wins=${r.outcomeWins} pnl=${r.outcomeTotalPnl?.toFixed(1)}%`);
  console.log('');
}