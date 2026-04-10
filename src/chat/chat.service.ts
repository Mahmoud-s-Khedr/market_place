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
  constructor(private readonly databaseService: DatabaseService) {}

  async getOrCreateConversation(userId: number, participantId: number): Promise<Record<string, unknown>> {
    if (userId === participantId) {
      throw new BadRequestException('Cannot start conversation with yourself');
    }

    await assertUserExists(this.databaseService, participantId, 'Participant');

    const [userAId, userBId] = userId < participantId ? [userId, participantId] : [participantId, userId];

    const existing = await this.databaseService.query<{ id: number }>(
      'SELECT id FROM conversations WHERE user_a_id = $1 AND user_b_id = $2 LIMIT 1',
      [userAId, userBId],
    );

    if (existing.rowCount) {
      return {
        success: true,
        conversation: { id: existing.rows[0].id, userAId, userBId },
      };
    }

    let insert: { rows: Array<{ id: number }> };
    try {
      insert = await this.databaseService.query<{ id: number }>(
        `INSERT INTO conversations (user_a_id, user_b_id)
         VALUES ($1, $2)
         RETURNING id`,
        [userAId, userBId],
      );
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new NotFoundException('Participant not found');
      }
      throw error;
    }

    return {
      success: true,
      conversation: { id: insert.rows[0].id, userAId, userBId },
    };
  }

  async listConversations(userId: number): Promise<Record<string, unknown>> {
    const query = await this.databaseService.query(
      `SELECT c.id,
              c.user_a_id,
              c.user_b_id,
              c.created_at,
              m.id AS last_message_id,
              m.message_text AS last_message_text,
              m.sent_at AS last_message_sent_at
       FROM conversations c
       LEFT JOIN messages m ON m.id = c.last_message_id
       WHERE c.user_a_id = $1 OR c.user_b_id = $1
       ORDER BY COALESCE(m.sent_at, c.created_at) DESC`,
      [userId],
    );

    return {
      success: true,
      conversations: query.rows,
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

    return {
      success: true,
      messages: query.rows,
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

    return {
      success: true,
      message: insert.rows[0],
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

    const updated = await this.databaseService.query(
      `UPDATE messages
       SET read_at = COALESCE(read_at, NOW())
       WHERE id = $1
       RETURNING id, conversation_id, sender_id, message_text, sent_at, read_at`,
      [messageId],
    );

    return {
      success: true,
      message: updated.rows[0],
    };
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
  }

}
