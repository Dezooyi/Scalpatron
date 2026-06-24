import Database from 'better-sqlite3';
import fs from 'fs';

const BOT_ID = '7152caca-a4f7-4bc6-8349-fa0b4e9c31c7';
const LOG_FILE = 'logs/trades-7152caca-a4f7-4bc6-8349-fa0b4e9c31c7.jsonl';
const db = new Database('data/scalpatron.db');

console.log('=== Agent-ORUGA Trading-Analyse ===\n');

// 1) Bot config
const bot = db.prepare('SELECT * FROM bots WHERE id = ?').get(BOT_ID);
console.log('BOT CONFIG:');
console.log(JSON.stringify(bot, null, 2));

// 2) Trades aus jsonl
const lines = fs.readFileSync(LOG_FILE, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
console.log(`\nAnzahl Trade-Events: ${lines.length}`);

const sells = lines.filter(t => t.action === 'SELL');
const buys = lines.filter(t => t.action === 'BUY');

const wins = sells.filter(t => (t.pnlPercent ?? 0) > 0);
const losses = sells.filter(t => (t.pnlPercent ?? 0) <= 0);
const winPnls = wins.map(t => t.pnlPercent);
const lossPnls = losses.map(t => t.pnlPercent);
const sum = (a) => a.reduce((s, x) => s + x, 0);
const avg = (a) => a.length ? sum(a) / a.length : 0;

console.log(`BUYs: ${buys.length}`);
console.log(`SELLs: ${sells.length}`);
console.log(`Wins: ${wins.length} (avg PnL: ${avg(winPnls).toFixed(2)}%)`);
console.log(`Losses: ${losses.length} (avg PnL: ${avg(lossPnls).toFixed(2)}%)`);
console.log(`Total PnL: ${sum([...winPnls, ...lossPnls]).toFixed(2)}%`);
console.log(`Win-Rate: ${((wins.length/sells.length)*100).toFixed(1)}%`);

// 3) Loss-Verteilung nach Bins
const bins = { '<-5%': 0, '-5..-3': 0, '-3..-1': 0, '-1..0': 0, '0..1': 0, '1..3': 0, '3..5': 0, '>5': 0 };
for (const t of sells) {
  const p = t.pnlPercent;
  if (p < -5) bins['<-5%']++;
  else if (p < -3) bins['-5..-3']++;
  else if (p < -1) bins['-3..-1']++;
  else if (p < 0) bins['-1..0']++;
  else if (p < 1) bins['0..1']++;
  else if (p < 3) bins['1..3']++;
  else if (p < 5) bins['3..5']++;
  else bins['>5']++;
}
console.log('\nPnL-Verteilung SELLs:');
console.log(bins);

// 4) Exit-Gründe: Wie wurde der Sell ausgelöst?
// Wir können das anhand der übergeordneten Logik und der Settings ableiten:
// Wenn pnlPercent negativ und nahe takeProfitThreshold -> TP
// Wenn pnlPercent positiv und nahe takeProfitThreshold -> TP-Hit
// Wenn spikePercent sehr negativ -> Drop/Sell-Drop
// Wir schauen auf Peak-Preis vs Sell-Preis: MFE (max favorable excursion)
// und die aktiven Settings pro Trade.

console.log('\n=== Analyse der Sell-Entscheidungen ===');

// 5) Buy/Sell Paarungen + MFE/MAE
const pairs = [];
let lastBuy = null;
for (const t of lines) {
  if (t.action === 'BUY') lastBuy = t;
  else if (t.action === 'SELL' && lastBuy) {
    const mfe = ((t.peakPrice - lastBuy.price) / lastBuy.price) * 100;
    const mae = ((t.price - lastBuy.price) / lastBuy.price) * 100;
    pairs.push({ buy: lastBuy, sell: t, mfe, mae, holdMs: t.timestamp - lastBuy.timestamp });
    lastBuy = null;
  }
}

const winners = pairs.filter(p => p.sell.pnlPercent > 0);
const losers = pairs.filter(p => p.sell.pnlPercent <= 0);

console.log(`\nVollständige Buy→Sell-Paare: ${pairs.length}`);
console.log(`Winners MFE avg: ${avg(winners.map(p => p.mfe)).toFixed(2)}% | hold: ${(avg(winners.map(p => p.holdMs))/1000).toFixed(1)}s`);
console.log(`Losers  MFE avg: ${avg(losers.map(p => p.mfe)).toFixed(2)}% | hold: ${(avg(losers.map(p => p.holdMs))/1000).toFixed(1)}s`);

// Wie oft hat der Bot einen Trade mit > 1% Gewinn NICHT mitgenommen?
// d.h. peak > buy*1.01 aber PnL <= 0
const givenBack = pairs.filter(p => p.mfe > 1 && p.sell.pnlPercent <= 0);
console.log(`Trades mit MFE > 1% aber am Ende mit Verlust: ${givenBack.length} (= "Given-Back" / verschenchte Gewinne)`);

// Wie oft hat der Bot Take-Profit getroffen?
// takeProfitThreshold ist im sell.settings -> wenn PnL >= sell.settings.takeProfitThreshold*100 -1
const tpHits = pairs.filter(p => p.sell.pnlPercent >= (p.sell.settings.takeProfitThreshold * 100 - 1));
console.log(`Trades die TP-Threshold erreicht haben: ${tpHits.length} (von ${pairs.length})`);

// Wie oft hätte ein trailing Stop besser funktioniert?
// Schau auf SELLs wo MFE > 2 aber End-PnL < 1
const missedTp = pairs.filter(p => p.mfe > 2 && p.sell.pnlPercent < 1);
console.log(`Trades mit MFE>2% aber End-PnL<1%: ${missedTp.length}`);

// 6) Settings-Drift über die Trades
console.log('\n=== Parameter-Drift über Zeit ===');
const first5 = pairs.slice(0, 5).map(p => p.sell.settings);
const last5 = pairs.slice(-5).map(p => p.sell.settings);
console.log('Frühe Settings (avg):');
const avgSettings = (arr) => {
  const keys = Object.keys(arr[0]);
  const out = {};
  for (const k of keys) out[k] = (avg(arr.map(s => s[k]))).toFixed(3);
  return out;
};
console.log(avgSettings(first5));
console.log('Letzte Settings (avg):');
console.log(avgSettings(last5));

// 7) Hold-Time Verteilung
const holds = pairs.map(p => p.holdMs / 1000);
const binsHold = { '<10s': 0, '10-30s': 0, '30-60s': 0, '60-120s': 0, '>120s': 0 };
for (const h of holds) {
  if (h < 10) binsHold['<10s']++;
  else if (h < 30) binsHold['10-30s']++;
  else if (h < 60) binsHold['30-60s']++;
  else if (h < 120) binsHold['60-120s']++;
  else binsHold['>120s']++;
}
console.log('\nHold-Time Verteilung:');
console.log(binsHold);

// 8) Performance nach Tageszeit (UTC)
const byHour = {};
for (const p of pairs) {
  const h = new Date(p.sell.timestamp).getUTCHours();
  if (!byHour[h]) byHour[h] = { count: 0, wins: 0, pnl: 0 };
  byHour[h].count++;
  if (p.sell.pnlPercent > 0) byHour[h].wins++;
  byHour[h].pnl += p.sell.pnlPercent;
}
console.log('\nWin-Rate nach Stunde (UTC):');
for (const [h, v] of Object.entries(byHour).sort((a, b) => +a[0] - +b[0])) {
  const wr = ((v.wins / v.count) * 100).toFixed(0);
  console.log(`  ${h}:00 — ${v.count} trades, WR ${wr}%, total ${v.pnl.toFixed(2)}%`);
}

// 9) Welche Exit-Bedingung führte zu Loss?
// Wir haben keine expliziten "Reasons" in den Logs — aber wir können aus Settings ableiten
const lossSettings = losers.map(l => l.sell.settings);
console.log('\n=== Loss-Trades Settings ===');
console.log('Avg settings bei Loss:', avgSettings(lossSettings));

// 10) Streaks
let maxWinStreak = 0, maxLossStreak = 0, curWin = 0, curLoss = 0;
for (const p of pairs) {
  if (p.sell.pnlPercent > 0) { curWin++; curLoss = 0; }
  else { curLoss++; curWin = 0; }
  maxWinStreak = Math.max(maxWinStreak, curWin);
  maxLossStreak = Math.max(maxLossStreak, curLoss);
}
console.log(`\nMax Win Streak: ${maxWinStreak}`);
console.log(`Max Loss Streak: ${maxLossStreak}`);

// 11) Output the most "regrettable" trades: MFE > 3%, End-PnL < -1%
console.log('\n=== Top 10 "Regret Trades" (MFE hoch, aber Verlust) ===');
const regrets = pairs
  .filter(p => p.mfe > 3 && p.sell.pnlPercent < -1)
  .sort((a, b) => (b.mfe + b.sell.pnlPercent) - (a.mfe + a.sell.pnlPercent))
  .slice(0, 10);
for (const r of regrets) {
  console.log(`  MFE ${r.mfe.toFixed(2)}% | PnL ${r.sell.pnlPercent.toFixed(2)}% | TP-Th ${(r.sell.settings.takeProfitThreshold*100).toFixed(1)}% | Drop-Th ${(r.sell.settings.sellDropThreshold*100).toFixed(1)}% | spike ${r.sell.spikePercent.toFixed(2)}% | hold ${(r.holdMs/1000).toFixed(0)}s`);
}

// 12) Buy-Qualität: Wie oft kam der Spike und bewegte sich nicht weiter?
const weakSpikes = buys.filter(b => b.spikePercent >= 1 && b.spikePercent < 2);
const strongSpikes = buys.filter(b => b.spikePercent >= 3);
console.log(`\nBuy-Spike-Verteilung:`);
console.log(`  Schwach (1-2%): ${weakSpikes.length}`);
console.log(`  Mittel (2-3%): ${buys.filter(b => b.spikePercent >= 2 && b.spikePercent < 3).length}`);
console.log(`  Stark (>=3%): ${strongSpikes.length}`);