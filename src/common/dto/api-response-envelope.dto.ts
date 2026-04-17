import { ApiProperty } from '@nestjs/swagger';

export class SuccessEnvelopeDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 200 })
  statusCode!: number;
}

export class EmptyDataDto {}
