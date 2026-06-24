import Database from 'better-sqlite3';
import fs from 'fs';

const BOT_ID = '7152caca-a4f7-4bc6-8349-fa0b4e9c31c7';
const LOG_FILE = 'logs/trades-7152caca-a4f7-4bc6-8349-fa0b4e9c31c7.jsonl';
const db = new Database('data/scalpatron.db');

const lines = fs.readFileSync(LOG_FILE, 'utf-8').trim().split('\n').map(l => JSON.parse(l));

// Build pairs
const pairs = [];
let lastBuy = null;
for (const t of lines) {
  if (t.action === 'BUY') lastBuy = t;
  else if (t.action === 'SELL' && lastBuy) {
    const dropFromPeak = ((t.peakPrice - t.price) / t.peakPrice) * 100;
    const tpLevel = lastBuy.price * (1 + t.settings.takeProfitThreshold);
    const hitTP = t.price >= tpLevel;
    const hitDrop = dropFromPeak >= t.settings.sellDropThreshold;
    pairs.push({ buy: lastBuy, sell: t, dropFromPeak, tpLevel, hitTP, hitDrop, pnl: t.pnlPercent });
    lastBuy = null;
  }
}

console.log(`Total Pairs: ${pairs.length}\n`);

// Categorize each sell: TP-trigger vs Drop-trigger
const exitBy = { take_profit: 0, drop_stop: 0, ambiguous: 0 };
const lossesBy = { take_profit: 0, drop_stop: 0, ambiguous: 0 };
const winsBy = { take_profit: 0, drop_stop: 0, ambiguous: 0 };

for (const p of pairs) {
  let category;
  if (p.hitTP && !p.hitDrop) category = 'take_profit';
  else if (!p.hitTP && p.hitDrop) category = 'drop_stop';
  else if (p.hitTP && p.hitDrop) category = 'ambiguous'; // both
  else category = 'ambiguous'; // should be rare

  exitBy[category]++;
  if (p.pnl > 0) winsBy[category]++;
  else lossesBy[category]++;
}

console.log('=== Exit-Trigger Verteilung ===');
console.log('Gesamt:', exitBy);
console.log('  Wins:', winsBy);
console.log('  Losses:', lossesBy);

console.log('\n=== Detail Losses ===');
console.log(`Verluste durch trailing-stop (drop): ${lossesBy.drop_stop}`);
console.log(`Verluste durch take-profit:          ${lossesBy.take_profit}`);
console.log(`Verluste ambig (beides/unknown):     ${lossesBy.ambiguous}`);

// Avg settings of each
const dropStopLosses = pairs.filter(p => p.pnl <= 0 && p.hitDrop && !p.hitTP);
const tpLosses = pairs.filter(p => p.pnl <= 0 && p.hitTP && !p.hitDrop);

const avgSettings = (arr) => {
  if (arr.length === 0) return {};
  const out = {};
  for (const k of Object.keys(arr[0].sell.settings)) {
    out[k] = (arr.reduce((s, p) => s + p.sell.settings[k], 0) / arr.length).toFixed(3);
  }
  return out;
};
console.log('\nAvg Settings bei Drop-Stop-Loss:', avgSettings(dropStopLosses));
console.log('Avg Settings bei TP-Loss:        ', avgSettings(tpLosses));

// Welche dropFromPeak-Werte hatten die Losses?
const dropDistLoss = {};
for (const p of pairs.filter(p => p.pnl <= 0)) {
  const bucket = Math.round(p.dropFromPeak * 10) / 10;
  dropDistLoss[bucket] = (dropDistLoss[bucket] || 0) + 1;
}
console.log('\ndropFromPeak Verteilung bei Losses (%):');
console.log(Object.entries(dropDistLoss).sort((a,b) => +a[0] - +b[0]).map(([k,v]) => `  ${k}%: ${v}`).join('\n'));

// Avg drop% from peak (peak -> exit) bei losses
const avgDropLoss = pairs.filter(p => p.pnl <= 0).reduce((s, p) => s + p.dropFromPeak, 0) / pairs.filter(p => p.pnl <= 0).length;
console.log(`\nAvg dropFromPeak bei Losses: ${avgDropLoss.toFixed(2)}%`);

// Wie viele Losses hatten dropFromPeak < sellDropThreshold (= wurden also NICHT durch Drop ausgelöst)?
// -> wurden vermutlich durch TP-Logik "fälschlicherweise" ausgelöst oder durch andere Sell-Signale
const suspiciousLosses = pairs.filter(p => p.pnl <= 0 && p.dropFromPeak < p.sell.settings.sellDropThreshold * 0.9);
console.log(`Losses mit dropFromPeak < 90% des sellDropThreshold: ${suspiciousLosses.length}`);
console.log('  → Diese Losses wurden vermutlich durch take_profit "fälschlich" getriggert oder durch Floor/Cooldown-Logik');

// Welche SELL-Settings hatten die größten Auswirkungen?
// Wir korrelieren Drop-Threshold mit Win-Rate
const bySettings = {};
for (const p of pairs) {
  const sd = Math.round(p.sell.settings.sellDropThreshold * 10) / 10;
  const tp = Math.round(p.sell.settings.takeProfitThreshold * 100) / 100;
  const key = `sd=${sd}|tp=${tp}`;
  if (!bySettings[key]) bySettings[key] = { count: 0, wins: 0, totalPnl: 0 };
  bySettings[key].count++;
  if (p.pnl > 0) bySettings[key].wins++;
  bySettings[key].totalPnl += p.pnl;
}
console.log('\n=== Win-Rate nach (sellDropThreshold, takeProfitThreshold) ===');
const arr = Object.entries(bySettings).map(([k, v]) => ({
  key: k,
  wr: (v.wins / v.count) * 100,
  ...v,
})).sort((a, b) => b.count - a.count).slice(0, 15);
for (const x of arr) {
  console.log(`  ${x.key}: ${x.count} trades, WR ${x.wr.toFixed(0)}%, total ${x.totalPnl.toFixed(1)}%`);
}

// Was wenn wir konservativer gewesen wären?
// Counterfactual: hätte der Bot mit höherem TP und höherem Drop-Threshold besser performt?
const conservative = pairs.filter(p =>
  p.sell.settings.takeProfitThreshold >= 0.05 &&
  p.sell.settings.sellDropThreshold >= 2.0
);
const consWins = conservative.filter(p => p.pnl > 0).length;
console.log(`\n=== Conservative Counterfactual (TP>=5% und Drop>=2%) ===`);
console.log(`Trades: ${conservative.length}, Wins: ${consWins}, WR ${((consWins / conservative.length) * 100).toFixed(0)}%`);
console.log(`Total PnL: ${conservative.reduce((s, p) => s + p.pnl, 0).toFixed(2)}%`);

const aggressive = pairs.filter(p =>
  p.sell.settings.takeProfitThreshold < 0.03 ||
  p.sell.settings.sellDropThreshold < 1.0
);
const aggWins = aggressive.filter(p => p.pnl > 0).length;
console.log(`\n=== Aggressive Counterfactual (TP<3% oder Drop<1%) ===`);
console.log(`Trades: ${aggressive.length}, Wins: ${aggWins}, WR ${((aggWins / aggressive.length) * 100).toFixed(0)}%`);
console.log(`Total PnL: ${aggressive.reduce((s, p) => s + p.pnl, 0).toFixed(2)}%`);

// Buy-Qualität: Sind die Buys selbst das Problem?
// MFE nach Buy: wie hoch ging der Preis nach dem Buy?
const buyQuality = pairs.map(p => p.mfe = ((p.sell.peakPrice - p.buy.price) / p.buy.price) * 100);
const mfeBuckets = { '<0.5%': 0, '0.5-1%': 0, '1-2%': 0, '2-3%': 0, '3-5%': 0, '>5%': 0 };
for (const p of pairs) {
  const m = p.mfe;
  if (m < 0.5) mfeBuckets['<0.5%']++;
  else if (m < 1) mfeBuckets['0.5-1%']++;
  else if (m < 2) mfeBuckets['1-2%']++;
  else if (m < 3) mfeBuckets['2-3%']++;
  else if (m < 5) mfeBuckets['3-5%']++;
  else mfeBuckets['>5%']++;
}
console.log('\n=== MFE (Max Favorable Excursion) pro Trade ===');
console.log(mfeBuckets);

// Wieviel % der Trades hatten überhaupt die Chance auf > 2% Gewinn?
const canWin = pairs.filter(p => p.mfe >= 2.0);
console.log(`\nTrades mit MFE >= 2%: ${canWin.length} (${((canWin.length/pairs.length)*100).toFixed(0)}%)`);
console.log(`  → davon gewonnen (PnL>0): ${canWin.filter(p => p.pnl > 0).length}`);