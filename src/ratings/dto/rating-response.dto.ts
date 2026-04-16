import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RelatedUserDto } from '../../common/dto/related-entities.dto';

export class RatingDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ type: RelatedUserDto, nullable: true })
  rater!: RelatedUserDto | null;

  @ApiProperty({ type: RelatedUserDto, nullable: true })
  rated_user!: RelatedUserDto | null;

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
