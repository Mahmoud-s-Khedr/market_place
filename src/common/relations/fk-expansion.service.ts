import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { FileReadUrlService } from '../../files/file-read-url.service';
import { mapToAppUser } from '../mappers/app-user.mapper';

type EntityType = 'user' | 'category' | 'product' | 'message' | 'conversation' | 'file';

type FkRule = {
  entity: EntityType;
  outputKey?: string;
  shouldExpand?: (container: Record<string, unknown>) => boolean;
};

type ResolverMap = Map<number, Record<string, unknown>>;

const FK_RULES: Record<string, FkRule> = {
  admin_id: { entity: 'user' },
  avatar_file_id: { entity: 'file' },
  blocked_id: { entity: 'user' },
  blocker_id: { entity: 'user' },
  category_id: { entity: 'category' },
  conversation_id: { entity: 'conversation' },
  file_id: { entity: 'file' },
  last_message_id: { entity: 'message' },
  owner_id: {
    entity: 'user',
    shouldExpand: (container) => !Object.prototype.hasOwnProperty.call(container, 'owner_type'),
  },
  parent_id: { entity: 'category' },
  peer_user_id: { entity: 'user' },
  product_id: { entity: 'product' },
  rated_user_id: { entity: 'user' },
  rater_id: { entity: 'user' },
  reported_user_id: { entity: 'user' },
  reporter_id: { entity: 'user' },
  reviewed_by: { entity: 'user', outputKey: 'reviewed_by' },
  sender_id: { entity: 'user' },
  target_user_id: { entity: 'user' },
  uploader_user_id: { entity: 'user' },
  user_a_id: { entity: 'user' },
  user_b_id: { entity: 'user' },
  user_id: { entity: 'user' },
};

@Injectable()
export class FkExpansionService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly fileReadUrlService: FileReadUrlService,
  ) {}

  async expand(payload: unknown): Promise<unknown> {
    const idsByEntity = this.collectIds(payload);
    const mapsByEntity = await this.resolveEntities(idsByEntity);
    return this.transformNode(payload, mapsByEntity);
  }

  private collectIds(payload: unknown): Map<EntityType, Set<number>> {
    const idsByEntity = new Map<EntityType, Set<number>>();

    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      if (!this.isObject(node)) return;

      for (const [key, rawValue] of Object.entries(node)) {
        const rule = FK_RULES[key];
        if (rule && (!rule.shouldExpand || rule.shouldExpand(node))) {
          const id = this.toPositiveInt(rawValue);
          if (id !== null) {
            if (!idsByEntity.has(rule.entity)) idsByEntity.set(rule.entity, new Set<number>());
            idsByEntity.get(rule.entity)!.add(id);
          }
        }

        if (this.isObject(rawValue) || Array.isArray(rawValue)) {
          walk(rawValue);
        }
      }
    };

    walk(payload);
    return idsByEntity;
  }

  private async resolveEntities(idsByEntity: Map<EntityType, Set<number>>): Promise<Map<EntityType, ResolverMap>> {
    const entityTypes = Array.from(idsByEntity.keys());
    const result = new Map<EntityType, ResolverMap>();

    await Promise.all(
      entityTypes.map(async (entity) => {
        const ids = Array.from(idsByEntity.get(entity) ?? []);
        if (ids.length === 0) {
          result.set(entity, new Map<number, Record<string, unknown>>());
          return;
        }

        let records: Record<string, unknown>[] = [];
        switch (entity) {
          case 'user':
            records = await this.fetchUsers(ids);
            break;
          case 'category':
            records = await this.fetchCategories(ids);
            break;
          case 'product':
            records = await this.fetchProducts(ids);
            break;
          case 'message':
            records = await this.fetchMessages(ids);
            break;
          case 'conversation':
            records = await this.fetchConversations(ids);
            break;
          case 'file':
            records = await this.fetchFiles(ids);
            break;
          default:
            records = [];
        }

        result.set(
          entity,
          new Map(records.map((item) => [Number(item.id), item])),
        );
      }),
    );

    return result;
  }

  private transformNode(node: unknown, mapsByEntity: Map<EntityType, ResolverMap>): unknown {
    if (Array.isArray(node)) {
      return node.map((item) => this.transformNode(item, mapsByEntity));
    }
    if (!this.isObject(node)) {
      return node;
    }

    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(node)) {
      const rule = FK_RULES[key];
      if (rule && (!rule.shouldExpand || rule.shouldExpand(node))) {
        const outputKey = rule.outputKey ?? this.deriveOutputKey(key);
        if (!Object.prototype.hasOwnProperty.call(out, outputKey)) {
          const id = this.toPositiveInt(value);
          out[outputKey] = id === null ? null : mapsByEntity.get(rule.entity)?.get(id) ?? null;
        }
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(out, key)) {
        continue;
      }
      out[key] = this.transformNode(value, mapsByEntity);
    }

    return out;
  }

  private async fetchUsers(ids: number[]): Promise<Record<string, unknown>[]> {
    const query = await this.databaseService.query<{
      id: number;
      ssn: string | null;
      name: string;
      phone: string;
      status: string;
      avatar_file_id: number | null;
      avatar_object_key: string | null;
      avatar_mime_type: string | null;
      avatar_purpose: string | null;
      avatar_status: string | null;
      avatar_created_at: string | null;
      avatar_uploaded_at: string | null;
      contact_info: string | null;
    }>(
      `SELECT u.id,
              u.ssn,
              u.name,
              u.phone,
              u.status,
              u.avatar_file_id,
              f.object_key AS avatar_object_key,
              f.mime_type AS avatar_mime_type,
              f.purpose AS avatar_purpose,
              f.status AS avatar_status,
              f.created_at::text AS avatar_created_at,
              f.uploaded_at::text AS avatar_uploaded_at,
              (
                SELECT uc.value
                FROM user_contacts uc
                WHERE uc.user_id = u.id
                ORDER BY uc.is_primary DESC, uc.id DESC
                LIMIT 1
              ) AS contact_info
       FROM users u
       LEFT JOIN files f ON f.id = u.avatar_file_id
       WHERE u.id = ANY($1::bigint[])`,
      [ids],
    );

    return query.rows.map((row) => ({
      ...mapToAppUser(row),
      contactInfo: row.contact_info,
      avatar: row.avatar_file_id && row.avatar_object_key
        ? {
            id: row.avatar_file_id,
            purpose: row.avatar_purpose ?? 'avatar',
            object_key: row.avatar_object_key,
            mime_type: row.avatar_mime_type,
            status: row.avatar_status ?? 'uploaded',
            created_at: row.avatar_created_at,
            uploaded_at: row.avatar_uploaded_at,
            url: this.fileReadUrlService.buildReadUrl(row.avatar_object_key, row.avatar_mime_type ?? ''),
          }
        : null,
    }));
  }

  private async fetchCategories(ids: number[]): Promise<Record<string, unknown>[]> {
    const query = await this.databaseService.query<{
      id: number;
      parent_id: number | null;
      name: string;
      created_at: string;
    }>(
      `SELECT id, parent_id, name, created_at
       FROM categories
       WHERE id = ANY($1::bigint[])`,
      [ids],
    );
    return query.rows;
  }

  private async fetchProducts(ids: number[]): Promise<Record<string, unknown>[]> {
    const query = await this.databaseService.query<{
      id: number;
      owner_id: number;
      name: string;
      price: string;
      status: string;
      city: string;
      created_at: string;
      owner_ssn: string | null;
      owner_name: string;
      owner_phone: string;
      owner_status: string;
      owner_avatar_file_id: number | null;
      owner_avatar_object_key: string | null;
      owner_avatar_mime_type: string | null;
      owner_avatar_purpose: string | null;
      owner_avatar_status: string | null;
      owner_avatar_created_at: string | null;
      owner_avatar_uploaded_at: string | null;
      owner_contact_info: string | null;
    }>(
      `SELECT p.id,
              p.owner_id,
              p.name,
              p.price,
              p.status,
              p.city,
              p.created_at,
              u.ssn AS owner_ssn,
              u.name AS owner_name,
              u.phone AS owner_phone,
              u.status AS owner_status,
              u.avatar_file_id AS owner_avatar_file_id,
              f.object_key AS owner_avatar_object_key,
              f.mime_type AS owner_avatar_mime_type,
              f.purpose AS owner_avatar_purpose,
              f.status AS owner_avatar_status,
              f.created_at::text AS owner_avatar_created_at,
              f.uploaded_at::text AS owner_avatar_uploaded_at,
              (
                SELECT uc.value
                FROM user_contacts uc
                WHERE uc.user_id = u.id
                ORDER BY uc.is_primary DESC, uc.id DESC
                LIMIT 1
              ) AS owner_contact_info
       FROM products p
       JOIN users u ON u.id = p.owner_id
       LEFT JOIN files f ON f.id = u.avatar_file_id
       WHERE p.id = ANY($1::bigint[]) AND p.deleted_at IS NULL`,
      [ids],
    );

    return query.rows.map((row) => ({
      id: row.id,
      name: row.name,
      price: row.price,
      status: row.status,
      city: row.city,
      created_at: row.created_at,
      owner: {
        ...mapToAppUser({
          id: row.owner_id,
          ssn: row.owner_ssn,
          name: row.owner_name,
          phone: row.owner_phone,
          status: row.owner_status,
        }),
        contactInfo: row.owner_contact_info,
        avatar: row.owner_avatar_file_id && row.owner_avatar_object_key
          ? {
              id: row.owner_avatar_file_id,
              purpose: row.owner_avatar_purpose ?? 'avatar',
              object_key: row.owner_avatar_object_key,
              mime_type: row.owner_avatar_mime_type,
              status: row.owner_avatar_status ?? 'uploaded',
              created_at: row.owner_avatar_created_at,
              uploaded_at: row.owner_avatar_uploaded_at,
              url: this.fileReadUrlService.buildReadUrl(
                row.owner_avatar_object_key,
                row.owner_avatar_mime_type ?? '',
              ),
            }
          : null,
      },
    }));
  }

  private async fetchMessages(ids: number[]): Promise<Record<string, unknown>[]> {
    const query = await this.databaseService.query<{
      id: number;
      message_text: string;
      sent_at: string;
      read_at: string | null;
    }>(
      `SELECT id, message_text, sent_at, read_at
       FROM messages
       WHERE id = ANY($1::bigint[])`,
      [ids],
    );

    return query.rows;
  }

  private async fetchConversations(ids: number[]): Promise<Record<string, unknown>[]> {
    const query = await this.databaseService.query<{
      id: number;
      created_at: string;
    }>(
      `SELECT id, created_at
       FROM conversations
       WHERE id = ANY($1::bigint[])`,
      [ids],
    );

    return query.rows;
  }

  private async fetchFiles(ids: number[]): Promise<Record<string, unknown>[]> {
    const query = await this.databaseService.query<{
      id: number;
      purpose: string;
      object_key: string;
      mime_type: string | null;
      status: string;
      created_at: string;
      uploaded_at: string | null;
    }>(
      `SELECT id, purpose, object_key, mime_type, status, created_at, uploaded_at
       FROM files
       WHERE id = ANY($1::bigint[])`,
      [ids],
    );

    return query.rows.map((row) => ({
      ...row,
      url: this.fileReadUrlService.buildReadUrl(row.object_key, row.mime_type ?? ''),
    }));
  }

  private deriveOutputKey(key: string): string {
    return key.endsWith('_id') ? key.slice(0, -3) : key;
  }

  private toPositiveInt(value: unknown): number | null {
    if (value === null || value === undefined) return null;

    if (typeof value === 'number') {
      if (!Number.isInteger(value) || value <= 0) return null;
      return value;
    }

    if (typeof value === 'string' && /^\d+$/.test(value)) {
      const parsed = Number.parseInt(value, 10);
      return parsed > 0 ? parsed : null;
    }

    return null;
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
