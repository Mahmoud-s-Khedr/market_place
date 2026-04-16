import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../common/types/auth-user.type';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class BlocksService {
  constructor(private readonly databaseService: DatabaseService) {}

  async blockUser(user: AuthUser, blockedUserId: number): Promise<Record<string, unknown>> {
    if (user.sub === blockedUserId) {
      throw new BadRequestException('You cannot block yourself');
    }

    const target = await this.databaseService.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [blockedUserId]);
    if (!target.rowCount) {
      throw new NotFoundException('User not found');
    }

    await this.databaseService.query(
      `INSERT INTO user_blocks (blocker_id, blocked_id)
       VALUES ($1, $2)
       ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
      [user.sub, blockedUserId],
    );

    return { success: true, message: 'User blocked' };
  }

  async unblockUser(user: AuthUser, blockedUserId: number): Promise<Record<string, unknown>> {
    await this.databaseService.query(
      'DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2',
      [user.sub, blockedUserId],
    );

    return { success: true, message: 'User unblocked' };
  }

  async listBlockedUsers(user: AuthUser): Promise<Record<string, unknown>> {
    const query = await this.databaseService.query(
      `SELECT u.id, u.name, u.phone, ub.created_at AS blocked_at
       FROM user_blocks ub
       JOIN users u ON u.id = ub.blocked_id
       WHERE ub.blocker_id = $1
       ORDER BY ub.created_at DESC`,
      [user.sub],
    );

    return {
      success: true,
      users: query.rows,
    };
  }
}
