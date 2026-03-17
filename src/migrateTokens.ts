import { db } from './db.js';

console.log('[Migration] Adding createdAt column to tokens table...');

try {
  // Prüfen ob die Spalte bereits existiert
  const tableInfo = db.pragma("table_info('tokens')") as any[];
  const hasCreatedAt = tableInfo.some(col => col.name === 'createdAt');
  
  if (hasCreatedAt) {
    console.log('[Migration] createdAt column already exists. No migration needed.');
  } else {
    // Spalte hinzufügen
    db.exec(`
      ALTER TABLE tokens ADD COLUMN createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000);
    `);
    console.log('[Migration] createdAt column added successfully!');
  }
  
  console.log('[Migration] Migration completed.');
} catch (error) {
  console.error('[Migration] Error:', (error as Error).message);
}
