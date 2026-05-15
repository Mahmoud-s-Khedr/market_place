import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { AuthUser } from '../common/types/auth-user.type';
import { DatabaseService } from '../database/database.service';
import { escapeLike } from '../common/helpers/db.helpers';
import { toPositiveInt } from '../common/helpers/id.helpers';
import { DEFAULT_PAGE_SIZE } from '../common/constants';
import { CreateProductDto } from './dto/create-product.dto';
import { ListMyProductsDto } from './dto/list-my-products.dto';
import { isAllowedProductSubcategory, isValidCategory, isValidSubcategory } from './product-taxonomy';
import { SearchProductsDto } from './dto/search-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductStatusDto } from './dto/update-product-status.dto';

type QueryRunner = {
  query: <T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

@Injectable()
export class ProductsService {
  constructor(private readonly databaseService: DatabaseService) {}

  async createProduct(user: AuthUser, dto: CreateProductDto): Promise<Record<string, unknown>> {
    return this.databaseService.withTransaction(async (client) => {
      this.assertCategoryPair(dto.category.trim(), dto.subcategory?.trim() ?? null, false);

      const insert = await client.query<{ id: number }>(
        `INSERT INTO products (
           owner_id, category, subcategory, name, description, price, city, address_text, details, is_negotiable, preferred_contact_method
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          user.sub,
          dto.category.trim(),
          dto.subcategory?.trim() ?? null,
          dto.name,
          dto.description,
          dto.price,
          dto.city,
          dto.addressText,
          dto.details ?? null,
          dto.isNegotiable ?? false,
          dto.preferredContactMethod ?? 'both',
        ],
      );

      const productId = insert.rows[0].id;

      if (dto.imageFileIds && dto.imageFileIds.length > 0) {
        await this.syncProductImages(client, user.sub, productId, dto.imageFileIds);
      }

      const product = await this.fetchProductWithImages(client, productId, user.sub);
      return { product,
      };
    });
  }

  async getProductById(productId: number, viewerUserId?: number): Promise<Record<string, unknown>> {
    const product = await this.fetchProductWithImages(this.databaseService, productId, viewerUserId);

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (viewerUserId && await this.hasBlockBetweenUsers(viewerUserId, Number(product.owner_id))) {
      throw new NotFoundException('Product not found');
    }

    return { product,
    };
  }

  async updateProduct(
    user: AuthUser,
    productId: number,
    dto: UpdateProductDto,
  ): Promise<Record<string, unknown>> {
    return this.databaseService.withTransaction(async (client) => {
      const ownership = await client.query<{ owner_id: number }>(
        'SELECT owner_id FROM products WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [productId],
      );
      if (!ownership.rowCount) throw new NotFoundException('Product not found');
      const ownerId = toPositiveInt(ownership.rows[0].owner_id);
      if (!ownerId || ownerId !== user.sub) throw new ForbiddenException('Not allowed');
      const current = await client.query<{ category: string; subcategory: string | null }>(
        'SELECT category, subcategory FROM products WHERE id = $1',
        [productId],
      );
      const nextCategory = dto.category?.trim() ?? current.rows[0].category;
      const nextSubcategory = Object.prototype.hasOwnProperty.call(dto, 'subcategory')
        ? dto.subcategory?.trim() ?? null
        : current.rows[0].subcategory;
      this.assertCategoryPair(nextCategory, nextSubcategory, false);

      await client.query(
        `UPDATE products
         SET category = COALESCE($1, category),
             subcategory = CASE WHEN $2::boolean THEN $3 ELSE subcategory END,
             name = COALESCE($4, name),
             description = COALESCE($5, description),
             price = COALESCE($6, price),
             city = COALESCE($7, city),
             address_text = COALESCE($8, address_text),
             details = COALESCE($9, details),
             is_negotiable = COALESCE($10, is_negotiable),
             preferred_contact_method = COALESCE($11, preferred_contact_method),
             updated_at = NOW()
         WHERE id = $12`,
        [
          dto.category?.trim() ?? null,
          Object.prototype.hasOwnProperty.call(dto, 'subcategory'),
          dto.subcategory?.trim() ?? null,
          dto.name ?? null,
          dto.description ?? null,
          dto.price ?? null,
          dto.city ?? null,
          dto.addressText ?? null,
          dto.details ?? null,
          dto.isNegotiable ?? null,
          dto.preferredContactMethod ?? null,
          productId,
        ],
      );

      if (dto.imageFileIds) {
        await this.syncProductImages(client, user.sub, productId, dto.imageFileIds);
      }

      const product = await this.fetchProductWithImages(client, productId, user.sub);
      return { product,
      };
    });
  }

  async deleteProduct(user: AuthUser, productId: number): Promise<Record<string, unknown>> {
    return this.databaseService.withTransaction(async (client) => {
      const ownership = await client.query<{ owner_id: number }>(
        'SELECT owner_id FROM products WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [productId],
      );
      if (!ownership.rowCount) throw new NotFoundException('Product not found');
      const ownerId = toPositiveInt(ownership.rows[0].owner_id);
      if (!ownerId || ownerId !== user.sub) throw new ForbiddenException('Not allowed');

      await client.query('UPDATE products SET deleted_at = NOW() WHERE id = $1', [productId]);
      return { message: 'Product deleted' };
    });
  }

  async updateProductStatus(
    user: AuthUser,
    productId: number,
    dto: UpdateProductStatusDto,
  ): Promise<Record<string, unknown>> {
    return this.databaseService.withTransaction(async (client) => {
      const ownership = await client.query<{ owner_id: number }>(
        'SELECT owner_id FROM products WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [productId],
      );
      if (!ownership.rowCount) throw new NotFoundException('Product not found');
      const ownerId = toPositiveInt(ownership.rows[0].owner_id);
      if (!ownerId || ownerId !== user.sub) throw new ForbiddenException('Not allowed');

      const query = await client.query(
        `UPDATE products
         SET status = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, status, updated_at::text AS updated_at`,
        [dto.status, productId],
      );

      return { product: query.rows[0] };
    });
  }

  async listMyProducts(user: AuthUser, dto: ListMyProductsDto): Promise<Record<string, unknown>> {
    this.assertSearchCategoryPair(dto.category, dto.subcategory);

    const leadingParams: unknown[] = [user.sub];
    const { whereClause, params } = this.buildSearchFilters(dto, leadingParams, 'plv.');
    const allParams = [...leadingParams, ...params, dto.limit ?? DEFAULT_PAGE_SIZE, dto.offset ?? 0];
    const limitIdx = leadingParams.length + params.length + 1;
    const offsetIdx = leadingParams.length + params.length + 2;
    const { sortColumn, sortDir } = this.resolveSort(dto, {
      price: 'plv.price',
      address: 'plv.city',
      rate: 'plv.seller_rate',
      created: 'plv.created_at',
    });

    const query = await this.databaseService.query(
      `SELECT plv.id, plv.owner_id, plv.category, plv.subcategory, plv.name, plv.description, plv.price, plv.city,
              plv.address_text, plv.details, plv.status, plv.is_negotiable, plv.preferred_contact_method,
              plv.created_at::text AS created_at, plv.updated_at::text AS updated_at, plv.seller_rate,
              COALESCE((
                SELECT json_agg(row_to_json(img) ORDER BY img.sort_order ASC)
                FROM (
                  SELECT pi.id, pi.file_id, pi.sort_order, f.object_key, f.status
                  FROM product_images pi
                  JOIN files f ON f.id = pi.file_id
                  WHERE pi.product_id = plv.id
                ) img
              ), '[]'::json) AS images
       FROM product_listing_view plv
       WHERE plv.owner_id = $1 ${whereClause}
       ORDER BY ${sortColumn} ${sortDir}, plv.id DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      allParams,
    );

    return { items: query.rows,
    };
  }

  async searchProducts(dto: SearchProductsDto, viewerUserId?: number): Promise<Record<string, unknown>> {
    this.assertSearchCategoryPair(dto.category, dto.subcategory);

    const leadingParams: unknown[] = [];
    const { whereClause, params } = this.buildSearchFilters(dto, leadingParams, '');
    const allParams = [...params, dto.limit ?? DEFAULT_PAGE_SIZE, dto.offset ?? 0];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const viewerIdx = params.length + 3;

    const { sortColumn, sortDir } = this.resolveSort(dto, {
      price: 'plv.price',
      address: 'plv.city',
      rate: 'plv.seller_rate',
      created: 'plv.created_at',
    });

    const query = await this.databaseService.query(
      `SELECT plv.id, plv.owner_id, plv.category, plv.subcategory, plv.name, plv.description, plv.price, plv.city, plv.address_text, plv.details,
              plv.status, plv.is_negotiable, plv.preferred_contact_method,
              plv.created_at::text AS created_at, plv.updated_at::text AS updated_at, plv.seller_rate,
              CASE WHEN $${viewerIdx}::bigint IS NULL THEN NULL
                   ELSE EXISTS (
                     SELECT 1 FROM user_favorites uf
                     WHERE uf.user_id = $${viewerIdx}::bigint AND uf.product_id = plv.id
                   )
              END AS is_favorite,
              COALESCE((
                SELECT json_agg(row_to_json(img) ORDER BY img.sort_order ASC)
                FROM (
                  SELECT pi.id, pi.file_id, pi.sort_order, f.object_key, f.status
                  FROM product_images pi
                  JOIN files f ON f.id = pi.file_id
                  WHERE pi.product_id = plv.id
                ) img
              ), '[]'::json) AS images
       FROM product_listing_view plv
       WHERE plv.status = 'available' ${whereClause}
         AND (
           $${viewerIdx}::bigint IS NULL
           OR NOT EXISTS (
             SELECT 1
             FROM user_blocks ub
             WHERE (ub.blocker_id = $${viewerIdx}::bigint AND ub.blocked_id = plv.owner_id)
                OR (ub.blocked_id = $${viewerIdx}::bigint AND ub.blocker_id = plv.owner_id)
           )
         )
       ORDER BY ${sortColumn} ${sortDir}, plv.id DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...allParams, viewerUserId ?? null],
    );

    return { items: query.rows,
    };
  }

  private buildSearchFilters(
    dto: SearchProductsDto | ListMyProductsDto,
    leadingParams: unknown[],
    prefix: string,
  ): { whereClause: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const base = leadingParams.length;

    if ((dto as SearchProductsDto).category) {
      params.push((dto as SearchProductsDto).category);
      clauses.push(`AND ${prefix}category = $${base + params.length}`);
    }
    if ((dto as SearchProductsDto).subcategory && (dto as SearchProductsDto).subcategory !== 'all') {
      params.push((dto as SearchProductsDto).subcategory);
      clauses.push(`AND ${prefix}subcategory = $${base + params.length}`);
    }
    if (dto.minPrice !== undefined) {
      params.push(dto.minPrice);
      clauses.push(`AND ${prefix}price >= $${base + params.length}`);
    }
    if (dto.maxPrice !== undefined) {
      params.push(dto.maxPrice);
      clauses.push(`AND ${prefix}price <= $${base + params.length}`);
    }
    if (dto.fromDate) {
      params.push(dto.fromDate);
      clauses.push(`AND ${prefix}created_at >= $${base + params.length}`);
    }
    if (dto.toDate) {
      params.push(dto.toDate);
      clauses.push(`AND ${prefix}created_at <= $${base + params.length}`);
    }
    if (dto.city) {
      params.push(`%${escapeLike(dto.city)}%`);
      clauses.push(`AND ${prefix}city ILIKE $${base + params.length} ESCAPE '\\'`);
    }
    if (dto.addressText) {
      params.push(`%${escapeLike(dto.addressText)}%`);
      clauses.push(`AND ${prefix}address_text ILIKE $${base + params.length} ESCAPE '\\'`);
    }
    if (dto.q) {
      params.push(dto.q);
      clauses.push(
        `AND to_tsvector('simple', COALESCE(${prefix}name,'') || ' ' || COALESCE(${prefix}description,'')) @@ plainto_tsquery('simple', $${base + params.length})`,
      );
    }
    if ((dto as SearchProductsDto).minRate !== undefined) {
      params.push((dto as SearchProductsDto).minRate);
      clauses.push(`AND ${prefix}seller_rate >= $${base + params.length}`);
    }
    if (prefix && (dto as ListMyProductsDto).status) {
      params.push((dto as ListMyProductsDto).status);
      clauses.push(`AND ${prefix}status = $${base + params.length}`);
    }

    return {
      whereClause: clauses.length ? ` ${clauses.join(' ')}` : '',
      params,
    };
  }

  private async fetchProductWithImages(
    runner: QueryRunner,
    productId: number,
    viewerUserId?: number,
  ): Promise<Record<string, unknown> | null> {
    const product = await runner.query(
      `SELECT id, owner_id, category, subcategory, name, description, price, city, address_text, details,
              status, is_negotiable, preferred_contact_method,
              created_at::text AS created_at, updated_at::text AS updated_at
       FROM products
       WHERE id = $1 AND deleted_at IS NULL`,
      [productId],
    );

    if (!product.rowCount) {
      return null;
    }

    const images = await runner.query(
      `SELECT pi.id, pi.file_id, pi.sort_order, f.object_key, f.status
       FROM product_images pi
       JOIN files f ON f.id = pi.file_id
       WHERE pi.product_id = $1
       ORDER BY pi.sort_order ASC`,
      [productId],
    );

    let isFavorite: boolean | null = null;
    if (viewerUserId) {
      const favorite = await runner.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM user_favorites WHERE user_id = $1 AND product_id = $2
         ) AS exists`,
        [viewerUserId, productId],
      );
      isFavorite = favorite.rows[0]?.exists ?? false;
    }

    return {
      ...(product.rows[0] as Record<string, unknown>),
      is_favorite: isFavorite,
      images: images.rows,
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

  private assertCategoryPair(category: string, subcategory: string | null, allowAll: boolean): void {
    if (!isValidCategory(category)) {
      throw new BadRequestException('Invalid category');
    }
    if (subcategory === null) {
      return;
    }
    if (!isValidSubcategory(category, subcategory)) {
      throw new BadRequestException('Invalid subcategory for category');
    }
    if (!allowAll && !isAllowedProductSubcategory(category, subcategory)) {
      throw new BadRequestException('subcategory cannot be all');
    }
  }

  private assertSearchCategoryPair(category?: string, subcategory?: string): void {
    if (!category || !subcategory) return;
    this.assertCategoryPair(category, subcategory, true);
  }

  private resolveSort(
    dto: SearchProductsDto,
    sortColumnMap: Record<'price' | 'address' | 'rate' | 'created', string>,
  ): { sortColumn: string; sortDir: 'ASC' | 'DESC' } {
    const sortColumn = sortColumnMap[dto.sortBy ?? 'created'];
    if (!sortColumn) throw new BadRequestException('Invalid sort field');
    const sortDir: 'ASC' | 'DESC' = (dto.sortDir ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    return { sortColumn, sortDir };
  }

  private async syncProductImages(
    client: PoolClient,
    actorUserId: number,
    productId: number,
    imageFileIds: number[],
  ): Promise<void> {
    await client.query('DELETE FROM product_images WHERE product_id = $1', [productId]);

    if (imageFileIds.length === 0) return;

    // Batch-fetch all files in one query
    const placeholders = imageFileIds.map((_, i) => `$${i + 1}`).join(', ');
    const files = await client.query<{
      id: number;
      object_key: string;
      purpose: string;
      status: string;
      uploader_user_id: number | null;
    }>(
      `SELECT id, object_key, purpose, status, uploader_user_id FROM files WHERE id IN (${placeholders})`,
      imageFileIds,
    );
    const fileMap = new Map<number, typeof files.rows[number]>(
      files.rows.map((f) => [Number(f.id), f]),
    );

    // Validate all files in memory
    for (const fileId of imageFileIds) {
      const file = fileMap.get(fileId);
      if (!file) throw new BadRequestException(`File ${fileId} does not exist`);
      if (file.purpose !== 'product_image') throw new BadRequestException(`File ${fileId} must have purpose product_image`);
      const uploaderUserId = toPositiveInt(file.uploader_user_id);
      if (!uploaderUserId || uploaderUserId !== actorUserId) throw new ForbiddenException(`File ${fileId} is not owned by the current user`);
      if (file.status !== 'uploaded') throw new BadRequestException(`File ${fileId} must be uploaded before product association`);
    }

    // Batch insert product_images rows
    const insertValues = imageFileIds
      .map((_, i) => `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`)
      .join(', ');
    const insertParams: unknown[] = [productId];
    imageFileIds.forEach((fileId, i) => {
      insertParams.push(fileId, fileMap.get(fileId)!.object_key, i);
    });
    await client.query(
      `INSERT INTO product_images (product_id, file_id, object_key, sort_order) VALUES ${insertValues}`,
      insertParams,
    );

    // Batch update file ownership
    await client.query(
      `UPDATE files SET owner_type = 'product', owner_id = $1, updated_at = NOW() WHERE id = ANY($2::bigint[])`,
      [productId, imageFileIds],
    );
  }
}
