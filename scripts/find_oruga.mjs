import Database from 'better-sqlite3';
const db = new Database('data/scalpatron.db');
const all = db.prepare("SELECT id, name, mintAddress, status, paperMode, strategyId FROM bots").all();
console.log('---ALL BOTS---');
console.log(JSON.stringify(all, null, 2));