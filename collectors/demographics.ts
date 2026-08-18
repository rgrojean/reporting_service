import 'dotenv/config';
import { pick, ProjectedPatient } from '../lib/pick';
import { writeSnapshot, FacilitySnapshot } from '../lib/store';

const FACILITIES = ['RVB', 'SAM'];
const MISSING_FIELD_THRESHOLD = 0.005;

export type FetchPage = (
  facility: string,
  page: number
) => Promise<{ data: Record<string, unknown>[]; meta: { total: number; page: number; nextPage: number | null } }>;

export async function collectDemographics(
  fetchPage: FetchPage,
  opts?: { runId?: string; asOf?: string }
): Promise<{ runId: string; path: string }> {
  const runId =
    opts?.runId ??
    `demographics_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${Date.now()}`;
  const asOf = opts?.asOf ?? new Date().toISOString().slice(0, 10);
  const facilities: FacilitySnapshot[] = [];
  let totalSeen = 0;
  let missingPick = 0;

  for (const facility of FACILITIES) {
    const seen = new Set<string>();
    const records: ProjectedPatient[] = [];
    let page = 1;
    let metaTotal = 0;
    while (true) {
      const body = await fetchPage(facility, page);
      metaTotal = body.meta.total;
      for (const raw of body.data) {
        totalSeen += 1;
        const projected = pick(raw);
        if (!projected) {
          missingPick += 1;
          continue;
        }
        if (seen.has(projected.patientId)) continue;
        seen.add(projected.patientId);
        records.push(projected);
      }
      if (body.meta.nextPage == null) break;
      page = body.meta.nextPage;
    }
    facilities.push({ facility, metaTotal, records });
  }

  if (totalSeen > 0 && missingPick / totalSeen > MISSING_FIELD_THRESHOLD) {
    const pct = ((missingPick / totalSeen) * 100).toFixed(2);
    throw new Error(
      `Missing-field guard: ${missingPick}/${totalSeen} records (${pct}%) missing a picked field ` +
        `(identifier(urn:riverbend:mrn)|gender|dob|address.zip) — exceeds 0.5% threshold. Aborting run.`
    );
  }

  const snapPath = writeSnapshot({ runId, pulledAt: new Date().toISOString(), asOf, facilities });
  return { runId, path: snapPath };
}

async function defaultFetchPage(facility: string, page: number) {
  const base = process.env.PIS_URL;
  if (!base) throw new Error('PIS_URL is not set');
  const url = `${base.replace(/\/$/, '')}/v2/patients?facility=${facility}&page=${page}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PIS ${url} → ${res.status}`);
  return (await res.json()) as Awaited<ReturnType<FetchPage>>;
}

if (require.main === module) {
  collectDemographics(defaultFetchPage)
    .then(({ runId, path }) => console.log(`snapshot written: ${path} (run ${runId})`))
    .catch((err) => {
      console.error(err.message || err);
      process.exit(1);
    });
}
