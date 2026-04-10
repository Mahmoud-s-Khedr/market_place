import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RatingDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 5 })
  rater_id!: number;

  @ApiProperty({ example: 8 })
  rated_user_id!: number;

  @ApiProperty({ example: 4, minimum: 1, maximum: 5 })
  rating_value!: number;

  @ApiPropertyOptional({ example: 'Great seller, fast delivery', nullable: true })
  comment!: string | null;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  created_at!: string;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  updated_at!: string;
}

export class RatingResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: RatingDto })
  rating!: RatingDto;
}

export class RatingSummaryDto {
  @ApiProperty({ example: '4.50', description: 'Average rating (2 decimal places as numeric string)' })
  avg_rating!: string;

  @ApiProperty({ example: 12 })
  ratings_count!: number;
}

export class RatingSummaryResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: RatingSummaryDto })
  summary!: RatingSummaryDto;

  @ApiProperty({ type: [RatingDto] })
  ratings!: RatingDto[];
}
