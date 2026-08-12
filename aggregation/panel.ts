import { runPanel } from './reports';

if (require.main === module) {
  const result = runPanel(process.argv[2]);
  console.log(`panel report run_id=${result.runId}`, result.rows);
}
