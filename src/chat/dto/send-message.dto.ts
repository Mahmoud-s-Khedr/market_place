import { IsInt, IsString, Length, Min } from 'class-validator';

export class SendMessageDto {
  @IsInt()
  @Min(1)
  conversationId!: number;

  @IsString()
  @Length(1, 4000)
  text!: string;
}
