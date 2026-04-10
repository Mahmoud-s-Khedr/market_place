import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateRatingDto {
  @ApiProperty({ description: 'ID of the user being rated', example: 15, minimum: 1 })
  @IsInt()
  @Min(1)
  ratedUserId!: number;

  @ApiProperty({ description: 'Star rating (1–5)', example: 4, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  ratingValue!: number;

  @ApiPropertyOptional({ description: 'Optional review comment (1–2000 chars)', example: 'Great seller, fast shipping!', minLength: 1, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  comment?: string;
}
