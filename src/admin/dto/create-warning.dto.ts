import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Length, Min } from 'class-validator';

export class CreateWarningDto {
  @ApiProperty({ description: 'ID of the user to warn', example: 42, minimum: 1 })
  @IsInt()
  @Min(1)
  targetUserId!: number;

  @ApiProperty({ description: 'Warning message (2–2000 chars)', example: 'Your listing violated our terms of service.', minLength: 2, maxLength: 2000 })
  @IsString()
  @Length(2, 2000)
  message!: string;
}
