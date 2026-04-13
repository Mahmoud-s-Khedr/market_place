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
import { DEFAULT_PAGE_SIZE } from '../common/constants';
import { CreateProductDto } from './dto/create-product.dto';
import { ListMyProductsDto } from './dto/list-my-products.dto';
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
      await this.assertLeafCategory(client, dto.categoryId);

      const insert = await client.query<{ id: number }>(
        `INSERT INTO products (owner_id, category_id, name, description, price, city, address_text, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [user.sub, dto.categoryId, dto.name, dto.description, dto.price, dto.city, dto.addressText, dto.details ?? null],
      );

      const productId = insert.rows[0].id;

      if (dto.imageFileIds && dto.imageFileIds.length > 0) {
        await this.syncProductImages(client, user.sub, productId, dto.imageFileIds);
      }

      const product = await this.fetchProductWithImages(client, productId);
      return {
        success: true,
        product,
      };
    });
  }

  async getProductById(productId: number): Promise<Record<string, unknown>> {
    const product = await this.fetchProductWithImages(this.databaseService, productId);

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return {
      success: true,
      product,
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
      if (ownership.rows[0].owner_id !== user.sub) throw new ForbiddenException('Not allowed');

      if (dto.categoryId) {
        await this.assertLeafCategory(client, dto.categoryId);
      }

      await client.query(
        `UPDATE products
         SET category_id = COALESCE($1, category_id),
             name = COALESCE($2, name),
             description = COALESCE($3, description),
             price = COALESCE($4, price),
             city = COALESCE($5, city),
             address_text = COALESCE($6, address_text),
             details = COALESCE($7, details),
             updated_at = NOW()
         WHERE id = $8`,
        [
          dto.categoryId ?? null,
          dto.name ?? null,
          dto.description ?? null,
          dto.price ?? null,
          dto.city ?? null,
          dto.addressText ?? null,
          dto.details ?? null,
          productId,
        ],
      );

      if (dto.imageFileIds) {
        await this.syncProductImages(client, user.sub, productId, dto.imageFileIds);
      }

      const product = await this.fetchProductWithImages(client, productId);
      return {
        success: true,
        product,
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
      if (ownership.rows[0].owner_id !== user.sub) throw new ForbiddenException('Not allowed');

      await client.query('UPDATE products SET deleted_at = NOW() WHERE id = $1', [productId]);
      return { success: true, message: 'Product deleted' };
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
      if (ownership.rows[0].owner_id !== user.sub) throw new ForbiddenException('Not allowed');

      const query = await client.query(
        `UPDATE products
         SET status = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, status, updated_at`,
        [dto.status, productId],
      );

      return { success: true, product: query.rows[0] };
    });
  }

  async listMyProducts(user: AuthUser, dto: ListMyProductsDto): Promise<Record<string, unknown>> {
    const leadingParams: unknown[] = [user.sub];
    const { whereClause, params } = this.buildSearchFilters(dto, leadingParams, 'p.');
    const allParams = [...leadingParams, ...params, dto.limit ?? DEFAULT_PAGE_SIZE, dto.offset ?? 0];
    const limitIdx = leadingParams.length + params.length + 1;
    const offsetIdx = leadingParams.length + params.length + 2;

    const query = await this.databaseService.query(
      `SELECT p.id, p.owner_id, p.category_id, p.name, p.description, p.price, p.city,
              p.address_text, p.details, p.status, p.created_at, p.updated_at
       FROM products p
       WHERE p.owner_id = $1 AND p.deleted_at IS NULL ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      allParams,
    );

    return {
      success: true,
      items: query.rows,
    };
  }

  async searchProducts(dto: SearchProductsDto): Promise<Record<string, unknown>> {
    const leadingParams: unknown[] = [];
    const { whereClause, params } = this.buildSearchFilters(dto, leadingParams, '');
    const allParams = [...params, dto.limit ?? DEFAULT_PAGE_SIZE, dto.offset ?? 0];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const sortColumnMap: Record<string, string> = {
      price: 'price',
      address: 'city',
      rate: 'seller_rate',
      created: 'created_at',
    };
    const sortColumn = sortColumnMap[dto.sortBy ?? 'created'];
    if (!sortColumn) throw new BadRequestException('Invalid sort field');
    const sortDir = (dto.sortDir ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const query = await this.databaseService.query(
      `SELECT id, owner_id, category_id, name, description, price, city, address_text, details,
              status, created_at, updated_at, seller_rate
       FROM product_listing_view
       WHERE status = 'available' ${whereClause}
       ORDER BY ${sortColumn} ${sortDir}, id DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      allParams,
    );

    return {
      success: true,
      items: query.rows,
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

    if (dto.categoryId) {
      params.push(dto.categoryId);
      clauses.push(`AND ${prefix}category_id = $${base + params.length}`);
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
    if (!prefix && (dto as SearchProductsDto).minRate !== undefined) {
      params.push((dto as SearchProductsDto).minRate);
      clauses.push(`AND seller_rate >= $${base + params.length}`);
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

  private async fetchProductWithImages(runner: QueryRunner, productId: number): Promise<Record<string, unknown> | null> {
    const product = await runner.query(
      `SELECT id, owner_id, category_id, name, description, price, city, address_text, details,
              status, created_at, updated_at
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

    return {
      ...(product.rows[0] as Record<string, unknown>),
      images: images.rows,
    };
  }

  private async assertLeafCategory(client: PoolClient, categoryId: number): Promise<void> {
    const result = await client.query<{ is_leaf: boolean }>(
      `SELECT NOT EXISTS(SELECT 1 FROM categories WHERE parent_id = $1) AS is_leaf
       FROM categories WHERE id = $1`,
      [categoryId],
    );
    if (!result.rowCount) {
      throw new BadRequestException('Category not found');
    }
    if (!result.rows[0].is_leaf) {
      throw new BadRequestException('Category must be a leaf category');
    }
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
      if (file.uploader_user_id !== actorUserId) throw new ForbiddenException(`File ${fileId} is not owned by the current user`);
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
