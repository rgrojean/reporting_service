import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

export type FacilitySnapshot = {
  facility: string;
  metaTotal: number;
  records: Array<{ patientId: string; gender: string; dob: string; address: { zip: string } }>;
};

export type Snapshot = {
  runId: string;
  pulledAt: string;
  asOf: string;
  facilities: FacilitySnapshot[];
};

export function writeSnapshot(snapshot: Snapshot): string {
  const dir = path.join(process.cwd(), 'snapshots');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${snapshot.runId}.json`);
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
  return file;
}

export function readSnapshot(runIdOrPath: string): Snapshot {
  const file = runIdOrPath.endsWith('.json')
    ? runIdOrPath
    : path.join(process.cwd(), 'snapshots', `${runIdOrPath}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Snapshot;
}

export function latestSnapshotPath(): string {
  const dir = path.join(process.cwd(), 'snapshots');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) throw new Error('No snapshots found under snapshots/');
  return path.join(dir, files[files.length - 1]);
}

export function openMarts(dbPath?: string): Database.Database {
  const file = dbPath ?? path.join(process.cwd(), 'data', 'marts.sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS panel_monthly (
      facility TEXT, panel_size INTEGER, roster_count INTEGER, run_id TEXT, as_of TEXT
    );
    CREATE TABLE IF NOT EXISTS cohort_agesex (
      facility TEXT, age_band TEXT, gender TEXT, n INTEGER, run_id TEXT, as_of TEXT
    );
    CREATE TABLE IF NOT EXISTS cohort_geo (
      facility TEXT, zip3 TEXT, n INTEGER, run_id TEXT, as_of TEXT
    );
  `);
  return db;
}

export function writeCsv(filePath: string, headers: string[], rows: string[][]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
  }
  fs.writeFileSync(filePath, lines.join('\n') + '\n');
}

export function exportPath(name: string): string {
  return path.join(process.cwd(), 'exports', name);
}
