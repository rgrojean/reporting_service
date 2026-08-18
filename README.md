# Lighthouse — Operational Reporting Service

**Repo:** `reporting-service` · **Owning team:** Clinical Analytics · **In production since:** 2019 · **Stack:** TypeScript / Node 18 / cron / Postgres (marts) / CSV + dashboard exports

---

## What it is

Lighthouse produces the operational reports Riverbend's leadership and clinic managers actually read: monthly panel-size reports per clinic and provider, demographic cohort breakdowns (age band, gender, geography) used for outreach planning and community-benefit reporting, and a quarterly extract that feeds the state community-health filing. It is a read-only system: it aggregates, it never writes back to any clinical or identity system.

Nobody waits on Lighthouse in real time. Its consumers are scheduled: the first-of-month panel reports, the Monday operations dashboard refresh, and the quarterly regulatory extract.

## History

Lighthouse started in 2019 as two analysts' scripts and was promoted to a maintained service when the community-benefit reporting requirement made the quarterly extract load-bearing. Clinical Analytics runs it with one engineer and two analysts; the engineering culture is pragmatic — TypeScript because the platform template said so, tests where numbers have burned them before, and a strong institutional rule born of a 2021 incident in which a silently changed upstream field skewed a board report: **every number Lighthouse publishes must be recomputable** — inputs are snapshotted, and every report names the job run that produced it.

## Architecture

```
cron (monthly / weekly / quarterly)
   │
   ▼
collectors ──► PIS v3 (paged demographic pulls)
   │           Cadence DB replica (appointment volumes, read-only)
   ▼
snapshot store (raw pulls, dated)
   │
   ▼
aggregation jobs ──► report marts (Postgres) ──► CSV exports / dashboard tiles
```

Collectors pull raw inputs and snapshot them; aggregation jobs compute marts from snapshots, never from live calls. This two-phase design is the recomputability rule made structural: a report can always be rebuilt from the exact inputs that produced it.

## How Lighthouse consumes the Patient Identity Service

One collector (`collectors/demographics.ts`) pages through the roster endpoint per facility:

```
GET /v2/patients?facility=RVB&page=1..N
GET /v2/patients?facility=SAM&page=1..N
```

From each record it projects exactly four things into the snapshot: `patientId` (carried only as a dedup key within the pull — derived from the `identifier[]` entry whose `system` is `urn:riverbend:mrn`; it appears in no mart and no report), `gender`, `dob` (bucketed immediately into age bands at aggregation time), and `address.zip` (grouped to ZIP3 in all outputs). Everything else in the payload is dropped at projection (`pick()` with an explicit field list) — a deliberate choice from the 2022 privacy review: Lighthouse's snapshots were classified as a low-sensitivity store precisely because the projection keeps identifiers and contact data out, and the team wants to keep that classification. It also reads the roster response's paging envelope (`meta.total`, `meta.nextPage`) both for iteration and as the numerator of the panel-size reports themselves.

The consumption style is plain `fetch` + the explicit projection — no generated client, no schema validation beyond "the four fields I picked exist," enforced by a small guard that fails the collector run loudly if any picked field comes back missing on more than 0.5% of records (a threshold chosen after the 2021 incident: a trickle of nulls is data quality, a flood is a contract change, and the run should stop rather than publish).

## Data storage

Postgres marts (`panel_monthly`, `cohort_agesex`, `cohort_geo`) plus the dated snapshot store on disk. Snapshots are retained 8 quarters to cover restatement requests on the regulatory extract. No names, SSNs, phone numbers, or street addresses exist anywhere in Lighthouse — the projection is the boundary.

## Testing & CI

Focused where the scars are: aggregation jobs have solid tests with fixture snapshots and golden-number assertions (the 2021 incident's legacy); the collectors have tests for pagination and the missing-field guard. CI on PR: typecheck, tests. CODEOWNERS: Clinical Analytics.

## Operational notes

The quarterly extract is the job with a compliance calendar attached — it runs the first weekend after quarter close, and it is the only Lighthouse job anyone rehearses: the runbook includes a dry-run step and a checksum comparison against the prior quarter's structure. Because the demographic collector runs monthly (and the extract quarterly), Lighthouse can go weeks between PIS calls; the team has noted before that platform teams doing traffic analysis on PIS tend to under-count Lighthouse for exactly this reason, and has asked to be on the announcement list for any PIS changes rather than relying on being noticed in access logs.

## Data Samples
PIS v3 roster payload (first page, RVB). The collector reads `identifier[]` for dedup (`urn:riverbend:mrn`) and ignores `given`, `family`, `phone`, and `email` at projection.
{
  "data": [
    {
      "identifier": [{ "system": "urn:riverbend:mrn", "value": "200104" }],
      "given": ["Sarah"],
      "family": "Williams",
      "dob": "09/28/1987",
      "gender": "F",
      "phone": "931-555-0144",
      "email": "swilliams.sam@example.com",
      "address": {
        "line1": "14 Maple Court",
        "city": "Clarksville",
        "state": "TN",
        "zip": "37040"
      }
    },
    {
      "identifier": [{ "system": "urn:riverbend:mrn", "value": "550001" }],
      "given": ["Ravi"],
      "family": "Patel",
      "dob": "04/17/1968",
      "gender": "M",
      "phone": "931-555-0177",
      "email": "rpatel@example.com",
      "address": {
        "line1": "402 College St",
        "city": "Clarksville",
        "state": "TN",
        "zip": "37044"
      }
    },
    {
      "identifier": [{ "system": "urn:riverbend:mrn", "value": "550002" }],
      "given": ["Diego"],
      "family": "Ortiz",
      "dob": "02/11/1995",
      "gender": "M",
      "phone": "931-555-0166",
      "email": "dortiz@example.com",
      "address": {
        "line1": "88 Providence Blvd",
        "city": "Clarksville",
        "state": "TN",
        "zip": "37042"
      }
    },
    {
      "identifier": [{ "system": "urn:riverbend:mrn", "value": "200105" }],
      "given": ["James"],
      "family": "Mitchell",
      "dob": "05/22/1966",
      "gender": "M",
      "phone": "931-555-0301",
      "email": "jmitchell@example.com",
      "address": {
        "line1": "220 Riverside Dr",
        "city": "Clarksville",
        "state": "TN",
        "zip": "37040"
      }
    },
    {
      "identifier": [{ "system": "urn:riverbend:mrn", "value": "200106" }],
      "given": ["Emily"],
      "family": "Turner",
      "dob": "08/08/1994",
      "gender": "F",
      "phone": "931-555-0302",
      "email": "eturner@example.com",
      "address": {
        "line1": "15 Madison St",
        "city": "Clarksville",
        "state": "TN",
        "zip": "37040"
      }
    },
    {
      "identifier": [{ "system": "urn:riverbend:mrn", "value": "200107" }],
      "given": ["Carl"],
      "family": "Phillips",
      "dob": "11/16/1959",
      "gender": "M",
      "phone": "931-555-0303",
      "email": null,
      "address": {
        "line1": "780 Wilma Rudolph Blvd",
        "city": "Clarksville",
        "state": "TN",
        "zip": "37040"
      }
    },
    {
      "identifier": [{ "system": "urn:riverbend:mrn", "value": "200108" }],
      "given": ["Ruth"],
      "family": "Campbell",
      "dob": "02/02/1981",
      "gender": "F",
      "phone": "931-555-0304",
      "email": "rcampbell@example.com",
      "address": {
        "line1": "41 Peachers Mill Rd",
        "city": "Clarksville",
        "state": "TN",
        "zip": "37042"
      }
    },
    {
      "identifier": [{ "system": "urn:riverbend:mrn", "value": "200109" }],
      "given": ["Thomas"],
      "family": "Parker",
      "dob": "06/29/1970",
      "gender": "M",
      "phone": "931-555-0305",
      "email": "tparker@example.com",
      "address": {
        "line1": "310 Kraft St",
        "city": "Clarksville",
        "state": "TN",
        "zip": "37040"
      }
    },
    {
      "identifier": [{ "system": "urn:riverbend:mrn", "value": "200110" }],
      "given": ["Gloria"],
      "family": "Evans",
      "dob": "10/10/1948",
      "gender": "F",
      "phone": "931-555-0306",
      "email": "gevans@example.com",
      "address": {
        "line1": "9 Tiny Town Rd",
        "city": "Clarksville",
        "state": "TN",
        "zip": "37042"
      }
    },
    {
      "identifier": [{ "system": "urn:riverbend:mrn", "value": "200111" }],
      "given": ["Frank"],
      "family": "Edwards",
      "dob": "03/13/1989",
      "gender": "M",
      "phone": "931-555-0307",
      "email": null,
      "address": {
        "line1": "505 Fort Campbell Blvd",
        "city": "Clarksville",
        "state": "TN",
        "zip": "37042"
      }
    }
  ],
  "meta": {
    "total": 12,
    "page": 1,
    "nextPage": 2
  }
}
