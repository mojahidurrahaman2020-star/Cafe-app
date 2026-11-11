import { Prisma } from './prisma.js';

/**
 * Run a write at most once per client request id.
 * `findExisting` looks up the result of an earlier submission with the same id. If the
 * write races with a duplicate and hits the UNIQUE(request_id) constraint, the earlier
 * result is returned instead of an error — a double-tap is harmless.
 */
export async function idempotent<T>(
  run: () => Promise<T>,
  findExisting: () => Promise<T | null>,
): Promise<{ result: T; replayed: boolean }> {
  const existing = await findExisting();
  if (existing) return { result: existing, replayed: true };
  try {
    return { result: await run(), replayed: false };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const again = await findExisting();
      if (again) return { result: again, replayed: true };
    }
    throw err;
  }
}
