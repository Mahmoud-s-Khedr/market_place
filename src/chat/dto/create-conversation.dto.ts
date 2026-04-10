import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';

export class CreateConversationDto {
  @ApiProperty({ description: 'User ID of the other conversation participant', example: 12, minimum: 1 })
  @IsNumber()
  @Min(1)
  participantId!: number;
}
