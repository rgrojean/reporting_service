import { runQuarterly } from './reports';

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  const snapArg = process.argv.find((a, i) => i > 1 && a.endsWith('.json'));
  const result = runQuarterly(snapArg, { dryRun });
  console.log(`quarterly extract run_id=${result.runId} checksum=${result.checksum} dryRun=${dryRun}`);
  console.log(result.rows);
}
