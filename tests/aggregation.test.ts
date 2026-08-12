import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectDemographics, FetchPage } from '../collectors/demographics';
import { runPanel, runCohorts, runQuarterly } from '../aggregation/reports';

const fixtures = path.join(__dirname, '..', 'fixtures');

function load(name: string) {
  return JSON.parse(fs.readFileSync(path.join(fixtures, name), 'utf8'));
}

const fixtureFetch: FetchPage = async (facility, page) => {
  if (facility === 'RVB' && page === 1) return load('pis_rvb_page1.json');
  if (facility === 'RVB' && page === 2) return load('pis_rvb_page2.json');
  if (facility === 'SAM' && page === 1) return load('pis_sam_page1.json');
  throw new Error(`unexpected ${facility} page ${page}`);
};

describe('aggregation golden numbers', () => {
  let tmp: string;
  let prevCwd: string;
  let snapPath: string;
  let dbPath: string;

  beforeAll(async () => {
    prevCwd = process.cwd();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-agg-'));
    process.chdir(tmp);
    fs.mkdirSync('snapshots');
    fs.mkdirSync('exports');
    fs.mkdirSync('data');
    const collected = await collectDemographics(fixtureFetch, {
      runId: 'golden_20260801',
      asOf: '2026-08-01',
    });
    snapPath = collected.path;
    dbPath = path.join(tmp, 'data', 'marts.sqlite');
  });

  afterAll(() => {
    process.chdir(prevCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('panel_monthly: meta.total + roster counts, names the run', () => {
    const { runId, rows } = runPanel(snapPath, dbPath);
    expect(runId).toBe('golden_20260801');
    expect(rows).toEqual([
      { facility: 'RVB', panel_size: 12, roster_count: 12 },
      { facility: 'SAM', panel_size: 3, roster_count: 3 },
    ]);
    const csv = fs.readFileSync(path.join(tmp, 'exports', `panel_monthly_${runId}.csv`), 'utf8');
    expect(csv).toContain('golden_20260801');
    expect(csv).not.toMatch(/patientId|ssn|phone|name/i);
  });

  test('cohort_agesex golden counts as of 2026-08-01', () => {
    const { agesex } = runCohorts(snapPath, dbPath);
    const key = (r: { facility: string; age_band: string; gender: string }) =>
      `${r.facility}|${r.age_band}|${r.gender}`;
    const map = Object.fromEntries(agesex.map((r) => [key(r), r.n]));

    // RVB — computed from fixture dobs bucketed at aggregation time
    expect(map['RVB|18-34|F']).toBe(2);
    expect(map['RVB|18-34|M']).toBe(1);
    expect(map['RVB|35-49|F']).toBe(2);
    expect(map['RVB|35-49|M']).toBe(1);
    expect(map['RVB|50-64|M']).toBe(3);
    expect(map['RVB|65+|F']).toBe(1);
    expect(map['RVB|65+|M']).toBe(2);

    // SAM
    expect(map['SAM|35-49|F']).toBe(1);
    expect(map['SAM|50-64|M']).toBe(1);
    expect(map['SAM|65+|F']).toBe(1);
  });

  test('cohort_geo golden ZIP3 counts', () => {
    const { geo, runId } = runCohorts(snapPath, dbPath);
    const map = Object.fromEntries(geo.map((r) => [`${r.facility}|${r.zip3}`, r.n]));
    expect(map['RVB|370']).toBe(12);
    expect(map['SAM|372']).toBe(3);
    expect(runId).toBe('golden_20260801');
  });

  test('quarterly extract names run and is offline from snapshot', () => {
    const { runId, rows, checksum } = runQuarterly(snapPath, { dryRun: true });
    expect(runId).toBe('golden_20260801');
    expect(checksum).toMatch(/^[a-f0-9]{16}$/);
    const rvbTotal = rows.filter((r) => r.facility === 'RVB').reduce((s, r) => s + r.n, 0);
    const samTotal = rows.filter((r) => r.facility === 'SAM').reduce((s, r) => s + r.n, 0);
    expect(rvbTotal).toBe(12);
    expect(samTotal).toBe(3);
    // no patientId in extract rows
    expect(JSON.stringify(rows)).not.toMatch(/patientId|200104|ssn/i);
  });

  test('aggregation never needs live PIS — snapshot file alone is enough', () => {
    // delete nothing about PIS; just prove a second panel run from the same file works
    const again = runPanel(snapPath, dbPath);
    expect(again.rows[0].panel_size).toBe(12);
  });
});
