import { db } from './src/db.js';
const bots = db.prepare('SELECT * FROM bots').all();
console.log('Bots in DB:', bots);
const trades = db.prepare('SELECT * FROM trades LIMIT 5').all();
console.log('Recent trades in DB:', trades);
process.exit(0);
