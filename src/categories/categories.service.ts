import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import { CATEGORIES_CACHE_TTL_SECONDS } from '../common/constants';

const CATEGORIES_CACHE_KEY = 'categories:tree';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly redisService: RedisService,
  ) {}

  async listCategories(): Promise<Record<string, unknown>> {
    const cached = await this.redisService.get(CATEGORIES_CACHE_KEY);
    if (cached) {
      return { categories: JSON.parse(cached) };
    }

    const query = await this.databaseService.query(
      `SELECT id, parent_id, name, created_at
       FROM categories
       ORDER BY COALESCE(parent_id, 0), name`,
    );

    await this.redisService.set(CATEGORIES_CACHE_KEY, JSON.stringify(query.rows), CATEGORIES_CACHE_TTL_SECONDS);

    return { categories: query.rows,
    };
  }

  async createCategory(name: string, parentId: number | null): Promise<Record<string, unknown>> {
    if (parentId !== null) {
      const parent = await this.databaseService.query('SELECT id FROM categories WHERE id = $1 LIMIT 1', [parentId]);
      if (!parent.rowCount) {
        throw new NotFoundException('Parent category not found');
      }
    }

    let result: { rows: Array<Record<string, unknown>> };
    try {
      result = await this.databaseService.query(
        `INSERT INTO categories (name, parent_id)
         VALUES ($1, $2)
         RETURNING id, parent_id, name, created_at`,
        [name, parentId],
      );
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        throw new ConflictException('A category with that name already exists under the same parent');
      }
      throw err;
    }

    await this.redisService.del(CATEGORIES_CACHE_KEY);
    return { category: result.rows[0] };
  }

  async deleteCategory(id: number): Promise<Record<string, unknown>> {
    let result: { rowCount: number | null; rows: Array<Record<string, unknown>> };
    try {
      result = await this.databaseService.query(
        'DELETE FROM categories WHERE id = $1 RETURNING id, parent_id, name, created_at',
        [id],
      );
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === '23503') {
        throw new ConflictException('Category cannot be deleted: it has child categories or products referencing it');
      }
      throw err;
    }

    if (!result.rowCount) {
      throw new NotFoundException('Category not found');
    }

    await this.redisService.del(CATEGORIES_CACHE_KEY);
    return { category: result.rows[0] };
  }
}
