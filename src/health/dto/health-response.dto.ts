import { ApiProperty } from '@nestjs/swagger';
import { SuccessEnvelopeDto } from '../../common/dto/api-response-envelope.dto';

export class HealthDataDto {
  @ApiProperty({ example: 'ok' })
  status!: string;
}

export class HealthResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => HealthDataDto })
  data!: HealthDataDto;
}
