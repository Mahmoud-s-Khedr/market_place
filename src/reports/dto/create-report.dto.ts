import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Length, Min } from 'class-validator';

export class CreateReportDto {
  @ApiProperty({ description: 'ID of the user being reported', example: 20, minimum: 1 })
  @IsInt()
  @Min(1)
  reportedUserId!: number;

  @ApiProperty({ description: 'Reason for the abuse report (5–3000 chars)', example: 'This user posted fraudulent listings.', minLength: 5, maxLength: 3000 })
  @IsString()
  @Length(5, 3000)
  reason!: string;
}
