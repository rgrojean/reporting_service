import * as crypto from 'crypto';
import * as fs from 'fs';
import { ageBand, zip3 } from '../lib/pick';
import { openMarts, exportPath, writeCsv, latestSnapshotPath, readSnapshot } from '../lib/store';

export function runPanel(snapshotPath?: string, dbPath?: string) {
  const snap = readSnapshot(snapshotPath ?? latestSnapshotPath());
  const db = openMarts(dbPath);
  db.prepare('DELETE FROM panel_monthly WHERE run_id = ?').run(snap.runId);
  const insert = db.prepare(
    `INSERT INTO panel_monthly (facility, panel_size, roster_count, run_id, as_of) VALUES (?, ?, ?, ?, ?)`
  );
  const rows = snap.facilities.map((f) => {
    insert.run(f.facility, f.metaTotal, f.records.length, snap.runId, snap.asOf);
    return { facility: f.facility, panel_size: f.metaTotal, roster_count: f.records.length };
  });
  writeCsv(
    exportPath(`panel_monthly_${snap.runId}.csv`),
    ['facility', 'panel_size', 'roster_count', 'run_id', 'as_of'],
    rows.map((r) => [r.facility, String(r.panel_size), String(r.roster_count), snap.runId, snap.asOf])
  );
  db.close();
  return { runId: snap.runId, rows };
}

export function runCohorts(snapshotPath?: string, dbPath?: string) {
  const snap = readSnapshot(snapshotPath ?? latestSnapshotPath());
  const db = openMarts(dbPath);
  db.prepare('DELETE FROM cohort_agesex WHERE run_id = ?').run(snap.runId);
  db.prepare('DELETE FROM cohort_geo WHERE run_id = ?').run(snap.runId);
  const insAge = db.prepare(
    `INSERT INTO cohort_agesex (facility, age_band, gender, n, run_id, as_of) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insGeo = db.prepare(
    `INSERT INTO cohort_geo (facility, zip3, n, run_id, as_of) VALUES (?, ?, ?, ?, ?)`
  );
  const agesex: Array<{ facility: string; age_band: string; gender: string; n: number }> = [];
  const geo: Array<{ facility: string; zip3: string; n: number }> = [];

  for (const f of snap.facilities) {
    const ageMap = new Map<string, number>();
    const geoMap = new Map<string, number>();
    for (const r of f.records) {
      const ak = `${ageBand(r.dob, snap.asOf)}|${r.gender}`;
      ageMap.set(ak, (ageMap.get(ak) || 0) + 1);
      const z = zip3(r.address.zip);
      geoMap.set(z, (geoMap.get(z) || 0) + 1);
    }
    for (const [k, n] of ageMap) {
      const [age_band, gender] = k.split('|');
      insAge.run(f.facility, age_band, gender, n, snap.runId, snap.asOf);
      agesex.push({ facility: f.facility, age_band, gender, n });
    }
    for (const [z, n] of geoMap) {
      insGeo.run(f.facility, z, n, snap.runId, snap.asOf);
      geo.push({ facility: f.facility, zip3: z, n });
    }
  }
  writeCsv(
    exportPath(`cohort_agesex_${snap.runId}.csv`),
    ['facility', 'age_band', 'gender', 'n', 'run_id', 'as_of'],
    agesex.map((r) => [r.facility, r.age_band, r.gender, String(r.n), snap.runId, snap.asOf])
  );
  writeCsv(
    exportPath(`cohort_geo_${snap.runId}.csv`),
    ['facility', 'zip3', 'n', 'run_id', 'as_of'],
    geo.map((r) => [r.facility, r.zip3, String(r.n), snap.runId, snap.asOf])
  );
  db.close();
  return { runId: snap.runId, agesex, geo };
}

export function runQuarterly(snapshotPath?: string, opts?: { dryRun?: boolean }) {
  const snap = readSnapshot(snapshotPath ?? latestSnapshotPath());
  const counts = new Map<string, number>();
  for (const f of snap.facilities) {
    for (const r of f.records) {
      const key = [f.facility, ageBand(r.dob, snap.asOf), r.gender, zip3(r.address.zip)].join('|');
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const rows = [...counts.entries()]
    .map(([k, n]) => {
      const [facility, age_band, gender, z] = k.split('|');
      return { facility, age_band, gender, zip3: z, n };
    })
    .sort((a, b) =>
      `${a.facility}${a.age_band}${a.gender}${a.zip3}`.localeCompare(
        `${b.facility}${b.age_band}${b.gender}${b.zip3}`
      )
    );
  const structure = rows.map((r) => `${r.facility}|${r.age_band}|${r.gender}|${r.zip3}`).join('\n');
  const checksum = crypto.createHash('sha256').update(structure).digest('hex').slice(0, 16);
  if (!opts?.dryRun) {
    writeCsv(
      exportPath(`quarterly_extract_${snap.runId}.csv`),
      ['facility', 'age_band', 'gender', 'zip3', 'n', 'run_id', 'as_of', 'checksum'],
      rows.map((r) => [
        r.facility, r.age_band, r.gender, r.zip3, String(r.n), snap.runId, snap.asOf, checksum,
      ])
    );
    fs.writeFileSync(exportPath(`quarterly_checksum_${snap.runId}.txt`), `run_id=${snap.runId}\nchecksum=${checksum}\n`);
  }
  return { runId: snap.runId, rows, checksum };
}
