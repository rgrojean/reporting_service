// Explicit four-field pick — everything else dropped at projection (2022 privacy review).
export const RIVERBEND_MRN_SYSTEM = 'urn:riverbend:mrn';

export type ProjectedPatient = {
  patientId: string;
  gender: string;
  dob: string;
  address: { zip: string };
};

function patientIdFromIdentifiers(record: Record<string, unknown>): string | null {
  const identifiers = record.identifier as Array<{ system?: unknown; value?: unknown }> | undefined;
  if (!Array.isArray(identifiers)) return null;
  const entry = identifiers.find((id) => id.system === RIVERBEND_MRN_SYSTEM);
  if (entry?.value == null) return null;
  return String(entry.value);
}

export function pick(record: Record<string, unknown>): ProjectedPatient | null {
  const address = record.address as { zip?: unknown } | undefined;
  const patientId = patientIdFromIdentifiers(record);
  if (patientId == null || record.gender == null || record.dob == null || address?.zip == null) {
    return null;
  }
  return {
    patientId,
    gender: String(record.gender),
    dob: String(record.dob),
    address: { zip: String(address.zip) },
  };
}

export function ageBand(dob: string, asOf: string): string {
  const [mm, dd, yyyy] = dob.split('/').map(Number);
  const asOfDate = new Date(asOf + 'T00:00:00Z');
  const birth = new Date(Date.UTC(yyyy, mm - 1, dd));
  let age = asOfDate.getUTCFullYear() - birth.getUTCFullYear();
  const m = asOfDate.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && asOfDate.getUTCDate() < birth.getUTCDate())) age -= 1;
  if (age < 18) return '0-17';
  if (age < 35) return '18-34';
  if (age < 50) return '35-49';
  if (age < 65) return '50-64';
  return '65+';
}

export function zip3(zip: string): string {
  return zip.slice(0, 3);
}
