import { NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export async function assertUserExists(
  db: DatabaseService,
  userId: number,
  label = 'User',
): Promise<void> {
  const result = await db.query<{ id: number }>(
    'SELECT id FROM users WHERE id = $1 LIMIT 1',
    [userId],
  );
  if (!result.rowCount) {
    throw new NotFoundException(`${label} not found`);
  }
}

export function isForeignKeyViolation(error: unknown): boolean {
  return Boolean((error as { code?: string } | null)?.code === '23503');
}

export function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&');
}
