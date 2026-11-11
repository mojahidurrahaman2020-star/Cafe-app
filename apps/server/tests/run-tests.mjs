// Runs the API test-suite against a brand-new, throwaway PostgreSQL database.
//
// 1. CREATE DATABASE bitebrew_test_<timestamp>   (never touches existing data)
// 2. prisma migrate deploy                       (proves migrations apply to an empty DB)
// 3. vitest run
// 4. DROP the database created in step 1
//
// Connection: TEST_DATABASE_ADMIN_URL (a role with CREATEDB), defaulting to the
// local development role.
import { execSync } from 'node:child_process';
import pg from 'pg';

const adminUrl =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://bitebrew:bitebrew_dev@localhost:5432/postgres';
const dbName = `bitebrew_test_${Date.now()}`;
const testUrl = new URL(adminUrl);
testUrl.pathname = `/${dbName}`;

async function admin(sql) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

const env = { ...process.env, DATABASE_URL: testUrl.toString(), APP_ENV: 'test', LOG_LEVEL: 'silent' };
const run = (cmd) => execSync(cmd, { stdio: 'inherit', env });

await admin(`CREATE DATABASE "${dbName}"`);
console.log(`Created throwaway test database ${dbName}`);
let exitCode = 0;
try {
  run('npx prisma migrate deploy');
  run('npx prisma generate');
  run(`npx vitest run ${process.argv.slice(2).join(' ')}`);
} catch {
  exitCode = 1;
} finally {
  if (!process.env.KEEP_TEST_DB) {
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    console.log(`Dropped throwaway test database ${dbName}`);
  }
}
process.exit(exitCode);
