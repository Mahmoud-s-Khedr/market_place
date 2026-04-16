import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export class ListConversationsDto {
  @ApiPropertyOptional({
    description: 'Filter conversations by context',
    enum: ['all', 'buy', 'sell'],
    example: 'all',
  })
  @IsOptional()
  @IsEnum(['all', 'buy', 'sell'])
  scope?: 'all' | 'buy' | 'sell';
}
