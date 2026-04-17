import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuthUser } from '../common/types/auth-user.type';
import { DEFAULT_PAGE_SIZE } from '../common/constants';
import { ListFavoritesDto } from './dto/list-favorites.dto';

@Injectable()
export class FavoritesService {
  constructor(private readonly databaseService: DatabaseService) {}

  async addFavorite(user: AuthUser, productId: number): Promise<Record<string, unknown>> {
    const product = await this.databaseService.query<{ id: number; owner_id: number }>(
      'SELECT id, owner_id FROM products WHERE id = $1 AND deleted_at IS NULL LIMIT 1',
      [productId],
    );
    if (!product.rowCount) {
      throw new NotFoundException('Product not found');
    }

    if (await this.hasBlockBetweenUsers(user.sub, product.rows[0].owner_id)) {
      throw new BadRequestException('Cannot favorite this product');
    }

    await this.databaseService.query(
      `INSERT INTO user_favorites (user_id, product_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, product_id) DO NOTHING`,
      [user.sub, productId],
    );

    return { message: 'Product added to favorites' };
  }

  async removeFavorite(user: AuthUser, productId: number): Promise<Record<string, unknown>> {
    await this.databaseService.query(
      'DELETE FROM user_favorites WHERE user_id = $1 AND product_id = $2',
      [user.sub, productId],
    );

    return { message: 'Product removed from favorites' };
  }

  async listFavorites(user: AuthUser, dto: ListFavoritesDto): Promise<Record<string, unknown>> {
    const sortBy = dto.sortBy === 'price' ? 'plv.price' : 'uf.created_at';
    const sortDir = (dto.sortDir ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const limit = dto.limit ?? DEFAULT_PAGE_SIZE;
    const offset = dto.offset ?? 0;

    const query = await this.databaseService.query(
      `SELECT plv.id, plv.owner_id, plv.category_id, plv.name, plv.description, plv.price, plv.city,
              plv.address_text, plv.details, plv.status, plv.is_negotiable, plv.preferred_contact_method,
              plv.created_at, plv.updated_at, plv.seller_rate, TRUE AS is_favorite
       FROM user_favorites uf
       JOIN product_listing_view plv ON plv.id = uf.product_id
       WHERE uf.user_id = $1
         AND NOT EXISTS (
           SELECT 1
           FROM user_blocks ub
           WHERE (ub.blocker_id = $1 AND ub.blocked_id = plv.owner_id)
              OR (ub.blocked_id = $1 AND ub.blocker_id = plv.owner_id)
         )
       ORDER BY ${sortBy} ${sortDir}, plv.id DESC
       LIMIT $2 OFFSET $3`,
      [user.sub, limit, offset],
    );

    return { items: query.rows,
    };
  }

  private async hasBlockBetweenUsers(userId: number, otherUserId: number): Promise<boolean> {
    const blocked = await this.databaseService.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM user_blocks
         WHERE (blocker_id = $1 AND blocked_id = $2)
            OR (blocker_id = $2 AND blocked_id = $1)
       ) AS exists`,
      [userId, otherUserId],
    );

    return blocked.rows[0]?.exists ?? false;
  }
}
