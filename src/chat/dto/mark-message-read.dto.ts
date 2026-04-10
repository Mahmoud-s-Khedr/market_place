import { IsInt, Min } from 'class-validator';

export class MarkMessageReadDto {
  @IsInt()
  @Min(1)
  messageId!: number;
}
