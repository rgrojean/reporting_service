import { runCohorts } from './reports';

if (require.main === module) {
  const result = runCohorts(process.argv[2]);
  console.log(`cohorts report run_id=${result.runId}`);
  console.log('agesex', result.agesex);
  console.log('geo', result.geo);
}
