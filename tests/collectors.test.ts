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

function v3Record(
  mrn: string,
  fields: Partial<{
    gender: string;
    dob: string | undefined;
    zip: string;
  }> = {}
) {
  return {
    identifier: [{ system: 'urn:riverbend:mrn', value: mrn }],
    given: ['Test'],
    family: 'Patient',
    gender: fields.gender ?? 'F',
    dob: fields.dob ?? '01/01/1990',
    phone: '931-555-0000',
    email: null,
    address: { line1: '1 Test St', city: 'Clarksville', state: 'TN', zip: fields.zip ?? '37040' },
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
    expect(blob).not.toMatch(/ssn|phone|email|line1|given|family|Williams|Sarah/i);
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
      const data = Array.from({ length: 100 }, (_, i) => {
        const rec = v3Record(`p${i}`);
        if (i === 0) delete (rec as { dob?: string }).dob;
        return rec;
      });
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

  test('pick extracts dedup key from identifier[] with urn:riverbend:mrn', () => {
    const projected = pick({
      identifier: [{ system: 'urn:riverbend:mrn', value: '200104' }],
      given: ['Sarah'],
      family: 'Williams',
      gender: 'F',
      dob: '09/28/1987',
      address: { zip: '37040' },
    });
    expect(projected?.patientId).toBe('200104');
  });

  test('pick rejects records with no Riverbend-namespaced identifier', () => {
    expect(
      pick({
        identifier: [{ system: 'urn:stansgar:mrn', value: '550001' }],
        gender: 'M',
        dob: '04/17/1968',
        address: { zip: '37044' },
      })
    ).toBeNull();
    expect(
      pick({
        identifier: [],
        gender: 'M',
        dob: '04/17/1968',
        address: { zip: '37044' },
      })
    ).toBeNull();
  });

  test('collectDemographics succeeds against v3-shaped fixtures with unchanged record counts', async () => {
    const { path: snapPath } = await collectDemographics(fixtureFetch(), {
      runId: 'test_run_v3_counts',
      asOf: '2026-08-01',
    });
    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    expect(snap.facilities[0].records).toHaveLength(12);
    expect(snap.facilities[1].records).toHaveLength(3);
  });

  test('per-facility dedup still collapses duplicate identifier values within a facility pull', async () => {
    const dupFetch: FetchPage = async (facility, page) => {
      if (facility === 'SAM') {
        return { data: [], meta: { total: 0, page: 1, nextPage: null } };
      }
      const duplicate = v3Record('dup-mrn');
      return {
        data: [duplicate, duplicate, v3Record('unique-mrn')],
        meta: { total: 3, page: 1, nextPage: null },
      };
    };
    const { path: snapPath } = await collectDemographics(dupFetch, {
      runId: 'test_run_dedup',
      asOf: '2026-08-01',
    });
    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    expect(snap.facilities[0].records).toHaveLength(2);
    expect(snap.facilities[0].records.map((r: { patientId: string }) => r.patientId).sort()).toEqual([
      'dup-mrn',
      'unique-mrn',
    ]);
  });
});
