import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// `prisma generate` (part of every build) does not connect to a database, so a placeholder is
// used when DATABASE_URL is not set. Commands that do connect (migrate, the server) fail
// with a clear connection error rather than touching the wrong database.
const url = process.env.DATABASE_URL ?? 'postgresql://placeholder:placeholder@localhost:5432/placeholder';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx src/scripts/seed.ts' },
  datasource: { url },
});
