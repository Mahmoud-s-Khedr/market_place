import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { assertUserExists, isForeignKeyViolation } from '../common/helpers/db.helpers';

@Injectable()
export class ChatService {
  constructor(
    private readonly databaseService: DatabaseService,
  ) {}

  async getOrCreateConversation(
    userId: number,
    participantId: number,
    productId?: number,
  ): Promise<Record<string, unknown>> {
    if (userId === participantId) {
      throw new BadRequestException('Cannot start conversation with yourself');
    }

    await assertUserExists(this.databaseService, participantId, 'Participant');

    if (await this.hasBlockBetweenUsers(userId, participantId)) {
      throw new ForbiddenException('Conversation is not allowed');
    }

    const [userAId, userBId] = userId < participantId ? [userId, participantId] : [participantId, userId];

    let validatedProductId: number | null = null;
    if (productId) {
      const product = await this.databaseService.query<{ id: number; owner_id: number; status: string }>(
        'SELECT id, owner_id, status FROM products WHERE id = $1 AND deleted_at IS NULL LIMIT 1',
        [productId],
      );
      if (!product.rowCount) {
        throw new NotFoundException('Product not found');
      }

      const { owner_id: ownerId, status } = product.rows[0];
      const isParticipantOwner = ownerId === userId || ownerId === participantId;
      if (status !== 'available' && !isParticipantOwner) {
        throw new ForbiddenException('Product is not available for conversation');
      }

      validatedProductId = productId;
    }

    const existing = await this.databaseService.query<{ id: number; product_id: number | null }>(
      'SELECT id, product_id FROM conversations WHERE user_a_id = $1 AND user_b_id = $2 LIMIT 1',
      [userAId, userBId],
    );

    if (existing.rowCount) {
      const conversation = existing.rows[0];
      if (validatedProductId && !conversation.product_id) {
        await this.databaseService.query(
          'UPDATE conversations SET product_id = $1 WHERE id = $2',
          [validatedProductId, conversation.id],
        );
      }

      const hydrated = await this.getConversationById(userId, conversation.id);
      return hydrated;
    }

    let insert: { rows: Array<{ id: number }> };
    try {
      insert = await this.databaseService.query<{ id: number }>(
        `INSERT INTO conversations (user_a_id, user_b_id, product_id)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [userAId, userBId, validatedProductId],
      );
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new NotFoundException('Participant or product not found');
      }
      throw error;
    }

    return this.getConversationById(userId, insert.rows[0].id);
  }

  async listConversations(userId: number, scope: 'all' | 'buy' | 'sell' = 'all'): Promise<Record<string, unknown>> {
    const query = await this.databaseService.query(
      `SELECT c.id,
              c.product_id,
              c.created_at,
              m.id AS last_message_id,
              m.message_text AS last_message_text,
              m.sent_at AS last_message_sent_at,
              CASE WHEN c.user_a_id = $1 THEN c.user_b_id ELSE c.user_a_id END AS peer_user_id,
              COALESCE(unread.unread_count, 0) AS unread_count,
              p.name AS product_name,
              p.price AS product_price,
              pimg.object_key AS product_image_object_key
       FROM conversations c
       LEFT JOIN messages m ON m.id = c.last_message_id
       JOIN users peer ON peer.id = CASE WHEN c.user_a_id = $1 THEN c.user_b_id ELSE c.user_a_id END
       LEFT JOIN products p ON p.id = c.product_id AND p.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT pi.object_key
         FROM product_images pi
         WHERE pi.product_id = p.id
         ORDER BY pi.sort_order ASC
         LIMIT 1
       ) pimg ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS unread_count
         FROM messages um
         WHERE um.conversation_id = c.id
           AND um.sender_id <> $1
           AND um.read_at IS NULL
       ) unread ON TRUE
       WHERE (c.user_a_id = $1 OR c.user_b_id = $1)
         AND NOT EXISTS (
           SELECT 1
           FROM user_blocks ub
           WHERE (ub.blocker_id = $1 AND ub.blocked_id = CASE WHEN c.user_a_id = $1 THEN c.user_b_id ELSE c.user_a_id END)
              OR (ub.blocked_id = $1 AND ub.blocker_id = CASE WHEN c.user_a_id = $1 THEN c.user_b_id ELSE c.user_a_id END)
         )
         AND (
           $2::text = 'all'
           OR ($2::text = 'buy' AND c.product_id IS NOT NULL AND p.owner_id <> $1)
           OR ($2::text = 'sell' AND c.product_id IS NOT NULL AND p.owner_id = $1)
         )
       ORDER BY COALESCE(m.sent_at, c.created_at) DESC`,
      [userId, scope],
    );

    return { conversations: query.rows.map((row) => this.normalizeConversationRow(row as Record<string, unknown>)),
    };
  }

  async getConversationById(userId: number, conversationId: number): Promise<Record<string, unknown>> {
    await this.assertConversationParticipant(conversationId, userId);

    const query = await this.databaseService.query(
      `SELECT c.id,
              c.product_id,
              c.created_at,
              m.id AS last_message_id,
              m.message_text AS last_message_text,
              m.sent_at AS last_message_sent_at,
              CASE WHEN c.user_a_id = $1 THEN c.user_b_id ELSE c.user_a_id END AS peer_user_id,
              COALESCE(unread.unread_count, 0) AS unread_count,
              p.name AS product_name,
              p.price AS product_price,
              pimg.object_key AS product_image_object_key
       FROM conversations c
       LEFT JOIN messages m ON m.id = c.last_message_id
       JOIN users peer ON peer.id = CASE WHEN c.user_a_id = $1 THEN c.user_b_id ELSE c.user_a_id END
       LEFT JOIN products p ON p.id = c.product_id AND p.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT pi.object_key
         FROM product_images pi
         WHERE pi.product_id = p.id
         ORDER BY pi.sort_order ASC
         LIMIT 1
       ) pimg ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS unread_count
         FROM messages um
         WHERE um.conversation_id = c.id
           AND um.sender_id <> $1
           AND um.read_at IS NULL
       ) unread ON TRUE
       WHERE c.id = $2
       LIMIT 1`,
      [userId, conversationId],
    );

    if (!query.rowCount) {
      throw new NotFoundException('Conversation not found');
    }

    return { conversation: this.normalizeConversationRow(query.rows[0] as Record<string, unknown>),
    };
  }

  async listMessages(
    userId: number,
    conversationId: number,
    limit = 20,
    before?: string,
  ): Promise<Record<string, unknown>> {
    await this.assertConversationParticipant(conversationId, userId);

    const query = await this.databaseService.query(
      `SELECT id, conversation_id, sender_id, message_text, sent_at, read_at
       FROM messages
       WHERE conversation_id = $1
         AND ($2::timestamptz IS NULL OR sent_at < $2::timestamptz)
       ORDER BY sent_at DESC
       LIMIT $3`,
      [conversationId, before ?? null, limit],
    );

    return { messages: query.rows.map((row) => this.normalizeMessageRow(row as Record<string, unknown>)),
    };
  }

  async sendMessage(
    userId: number,
    conversationId: number,
    messageText: string,
  ): Promise<Record<string, unknown>> {
    await this.assertConversationParticipant(conversationId, userId);

    let insert: { rows: Array<Record<string, unknown>> };
    try {
      insert = await this.databaseService.query(
        `INSERT INTO messages (conversation_id, sender_id, message_text)
         VALUES ($1, $2, $3)
         RETURNING id, conversation_id, sender_id, message_text, sent_at, read_at`,
        [conversationId, userId, messageText],
      );
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new NotFoundException('Conversation not found');
      }
      throw error;
    }

    const messageId = (insert.rows[0] as { id: number }).id;
    await this.databaseService.query(
      'UPDATE conversations SET last_message_id = $1 WHERE id = $2',
      [messageId, conversationId],
    );

    return { message: this.normalizeMessageRow(insert.rows[0]),
    };
  }

  async markRead(userId: number, messageId: number): Promise<Record<string, unknown>> {
    const message = await this.databaseService.query<{
      id: number;
      conversation_id: number;
      sender_id: number;
      read_at: Date | null;
    }>('SELECT id, conversation_id, sender_id, read_at FROM messages WHERE id = $1', [messageId]);

    if (!message.rowCount) {
      throw new NotFoundException('Message not found');
    }

    await this.assertConversationParticipant(message.rows[0].conversation_id, userId);

    if (message.rows[0].sender_id === userId) {
      throw new ForbiddenException('Only recipients can mark messages as read');
    }

    const updated = await this.databaseService.query(
      `UPDATE messages
       SET read_at = COALESCE(read_at, NOW())
       WHERE id = $1
       RETURNING id, conversation_id, sender_id, message_text, sent_at, read_at`,
      [messageId],
    );

    return { message: this.normalizeMessageRow(updated.rows[0]),
    };
  }

  private normalizeMessageRow(row: Record<string, unknown>): Record<string, unknown> {
    return {
      ...row,
      sent_at: this.normalizeTimestamp(row.sent_at),
      read_at: row.read_at === null ? null : this.normalizeTimestamp(row.read_at),
    };
  }

  private normalizeConversationRow(row: Record<string, unknown>): Record<string, unknown> {
    return {
      ...row,
      created_at: this.normalizeTimestamp(row.created_at),
      last_message_sent_at: row.last_message_sent_at === null ? null : this.normalizeTimestamp(row.last_message_sent_at),
    };
  }

  private normalizeTimestamp(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (value && typeof value === 'object' && typeof (value as { toISOString?: unknown }).toISOString === 'function') {
      return ((value as { toISOString: () => string }).toISOString());
    }
    return String(value ?? '');
  }

  async assertConversationParticipant(conversationId: number, userId: number): Promise<void> {
    const query = await this.databaseService.query<{
      id: number;
      user_a_id: number;
      user_b_id: number;
    }>('SELECT id, user_a_id, user_b_id FROM conversations WHERE id = $1', [conversationId]);

    if (!query.rowCount) {
      throw new NotFoundException('Conversation not found');
    }

    const conversation = query.rows[0];
    if (conversation.user_a_id !== userId && conversation.user_b_id !== userId) {
      throw new ForbiddenException('Not a participant of this conversation');
    }

    const otherUserId = conversation.user_a_id === userId ? conversation.user_b_id : conversation.user_a_id;
    if (await this.hasBlockBetweenUsers(userId, otherUserId)) {
      throw new ForbiddenException('Conversation is not available');
    }
  }

  private async hasBlockBetweenUsers(userAId: number, userBId: number): Promise<boolean> {
    const block = await this.databaseService.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM user_blocks
         WHERE (blocker_id = $1 AND blocked_id = $2)
            OR (blocker_id = $2 AND blocked_id = $1)
       ) AS exists`,
      [userAId, userBId],
    );

    return block.rows[0]?.exists ?? false;
  }
}
