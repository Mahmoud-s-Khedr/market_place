import { ApiProperty } from '@nestjs/swagger';
import { SuccessEnvelopeDto } from '../../common/dto/api-response-envelope.dto';

export class BlockedUserDto {
  @ApiProperty({ example: 12 })
  id!: number;

  @ApiProperty({ example: 'Jana Ahmed' })
  name!: string;

  @ApiProperty({ example: '+201012345678' })
  phone!: string;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  blocked_at!: string;
}

export class BlockedUsersListDataDto {
  @ApiProperty({ type: [BlockedUserDto] })
  users!: BlockedUserDto[];
}

export class BlockedUsersListResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => BlockedUsersListDataDto })
  data!: BlockedUsersListDataDto;
}
