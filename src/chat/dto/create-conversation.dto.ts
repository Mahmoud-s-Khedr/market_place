import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class CreateConversationDto {
  @ApiProperty({ description: 'User ID of the other conversation participant', example: 12, minimum: 1 })
  @IsNumber()
  @Min(1)
  participantId!: number;

  @ApiProperty({
    description: 'Optional product ID to attach as context for the conversation',
    example: 45,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  productId?: number;
}
