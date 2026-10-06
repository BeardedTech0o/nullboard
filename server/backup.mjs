// Consistent online backup: node server/backup.mjs /path/to/backup.db
import { DatabaseSync } from 'node:sqlite';
const src = process.env.DB_PATH || 'data/nullboard.db';
const out = process.argv[2];
if (!out) { console.error('usage: node server/backup.mjs <output.db>'); process.exit(1); }
const db = new DatabaseSync(src);
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
db.close();
console.log(`Backed up ${src} to ${out}`);
