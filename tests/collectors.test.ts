import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectDemographics, FetchPage } from '../collectors/demographics';
import { pick } from '../lib/pick';

const fixtures = path.join(__dirname, '..', 'fixtures');

function load(name: string) {
  return JSON.parse(fs.readFileSync(path.join(fixtures, name), 'utf8'));
}

function fixtureFetch(): FetchPage {
  return async (facility, page) => {
    if (facility === 'RVB' && page === 1) return load('pis_rvb_page1.json');
    if (facility === 'RVB' && page === 2) return load('pis_rvb_page2.json');
    if (facility === 'SAM' && page === 1) return load('pis_sam_page1.json');
    throw new Error(`unexpected ${facility} page ${page}`);
  };
}

describe('collectors/demographics', () => {
  let tmp: string;
  let prevCwd: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-collect-'));
    process.chdir(tmp);
    fs.mkdirSync('snapshots');
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('pages RVB and SAM and projects only the four pick fields', async () => {
    const { path: snapPath } = await collectDemographics(fixtureFetch(), {
      runId: 'test_run_ok',
      asOf: '2026-08-01',
    });
    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    expect(snap.facilities.map((f: { facility: string }) => f.facility)).toEqual(['RVB', 'SAM']);
    expect(snap.facilities[0].metaTotal).toBe(12);
    expect(snap.facilities[0].records).toHaveLength(12);
    expect(snap.facilities[1].metaTotal).toBe(3);
    expect(snap.facilities[1].records).toHaveLength(3);

    const sample = snap.facilities[0].records[0];
    expect(Object.keys(sample).sort()).toEqual(['address', 'dob', 'gender', 'patientId']);
    expect(Object.keys(sample.address)).toEqual(['zip']);
    // contact / identity fields must not survive projection
    const blob = JSON.stringify(snap);
    expect(blob).not.toMatch(/ssn|phone|email|line1|Williams|Sarah|given|family/i);
  });

  test('paginates until nextPage is null', async () => {
    const pages: string[] = [];
    const tracking: FetchPage = async (facility, page) => {
      pages.push(`${facility}:${page}`);
      return fixtureFetch()(facility, page);
    };
    await collectDemographics(tracking, { runId: 'test_run_pages', asOf: '2026-08-01' });
    expect(pages).toEqual(['RVB:1', 'RVB:2', 'SAM:1']);
  });

  test('missing-field guard trips when >0.5% of records lack a picked field', async () => {
    const bad: FetchPage = async (facility, page) => {
      if (facility === 'SAM') {
        return { data: [], meta: { total: 0, page: 1, nextPage: null } };
      }
      // 100 records, 1 missing dob → 1% > 0.5%
      const data = Array.from({ length: 100 }, (_, i) => ({
        identifier: [{ system: 'urn:riverbend:mrn', value: `p${i}` }],
        given: ['Test'],
        family: 'User',
        gender: 'F',
        dob: i === 0 ? undefined : '01/01/1990',
        phone: '000-000-0000',
        email: null,
        address: { line1: '1 Test St', city: 'Test', state: 'TN', zip: '37040' },
      }));
      return { data, meta: { total: 100, page: 1, nextPage: null } };
    };

    await expect(collectDemographics(bad, { runId: 'test_run_guard', asOf: '2026-08-01' })).rejects.toThrow(
      /Missing-field guard/
    );
  });

  test('pick drops everything outside the explicit field list', () => {
    const raw = load('pis_rvb_page1.json').data[0];
    const projected = pick(raw);
    expect(projected).toEqual({
      patientId: '200104',
      gender: 'F',
      dob: '09/28/1987',
      address: { zip: '37040' },
    });
  });

  test('pick resolves patientId from identifier[] with urn:riverbend:mrn', () => {
    const projected = pick({
      identifier: [
        { system: 'urn:other:mrn', value: '999999' },
        { system: 'urn:riverbend:mrn', value: '200104' },
      ],
      given: ['Sarah'],
      family: 'Williams',
      gender: 'F',
      dob: '09/28/1987',
      phone: '000-000-0000',
      email: null,
      address: { line1: '1 St', city: 'C', state: 'TN', zip: '37040' },
    });
    expect(projected?.patientId).toBe('200104');
  });

  test('pick returns null when identifier[] lacks the Riverbend system entry', () => {
    const projected = pick({
      identifier: [{ system: 'urn:stansgar:mrn', value: '300001' }],
      given: ['Lan'],
      family: 'Nguyen',
      gender: 'F',
      dob: '12/01/1990',
      phone: '000-000-0000',
      email: null,
      address: { line1: '1 St', city: 'C', state: 'TN', zip: '37203' },
    });
    expect(projected).toBeNull();
  });

  test('dedup suppresses duplicate identifier values across paginated v3 roster pages', async () => {
    const dupId = '200104';
    const page1 = load('pis_rvb_page1.json');
    const page2 = load('pis_rvb_page2.json');
    const dupRecord = { ...page1.data[0] };
    const tracking: FetchPage = async (facility, page) => {
      if (facility === 'SAM') {
        return { data: [], meta: { total: 0, page: 1, nextPage: null } };
      }
      if (page === 1) return page1;
      return { data: [dupRecord, ...page2.data], meta: { total: 13, page: 2, nextPage: null } };
    };
    const { path: snapPath } = await collectDemographics(tracking, {
      runId: 'test_run_dedup',
      asOf: '2026-08-01',
    });
    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    const ids = snap.facilities[0].records.map((r: { patientId: string }) => r.patientId);
    expect(ids.filter((id: string) => id === dupId)).toHaveLength(1);
    expect(snap.facilities[0].records).toHaveLength(12);
  });
});
