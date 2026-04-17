import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../common/types/auth-user.type';
import { DatabaseService } from '../database/database.service';
import { CreateRatingDto } from './dto/create-rating.dto';
import { assertUserExists, isForeignKeyViolation } from '../common/helpers/db.helpers';

@Injectable()
export class RatingsService {
  constructor(private readonly databaseService: DatabaseService) {}

  async rateUser(user: AuthUser, dto: CreateRatingDto): Promise<Record<string, unknown>> {
    if (user.sub === dto.ratedUserId) {
      throw new BadRequestException('You cannot rate yourself');
    }

    await assertUserExists(this.databaseService, dto.ratedUserId, 'Rated user');

    let query: { rows: Array<Record<string, unknown>> };
    try {
      query = await this.databaseService.query(
        `INSERT INTO user_ratings (rater_id, rated_user_id, rating_value, comment)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (rater_id, rated_user_id)
         DO UPDATE SET rating_value = EXCLUDED.rating_value,
                       comment = EXCLUDED.comment,
                       updated_at = NOW()
         RETURNING id, rater_id, rated_user_id, rating_value, comment, created_at, updated_at`,
        [user.sub, dto.ratedUserId, dto.ratingValue, dto.comment ?? null],
      );
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new NotFoundException('Rated user not found');
      }
      throw error;
    }

    return { rating: query.rows[0],
    };
  }

  async getUserRatingSummary(userId: number): Promise<Record<string, unknown>> {
    const summary = await this.databaseService.query(
      `SELECT COALESCE(ROUND(AVG(rating_value)::numeric, 2), 0.00) AS avg_rating,
              COUNT(*)::int AS ratings_count
       FROM user_ratings
       WHERE rated_user_id = $1`,
      [userId],
    );

    const latest = await this.databaseService.query(
      `SELECT id, rater_id, rated_user_id, rating_value, comment, created_at, updated_at
       FROM user_ratings
       WHERE rated_user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [userId],
    );

    return { summary: summary.rows[0],
      ratings: latest.rows,
    };
  }

}
