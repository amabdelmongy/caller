import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ChatRequestDto {
  @ApiProperty({ example: 'UserName' })
  @IsString()
  @MinLength(1)
  username!: string;

  @ApiProperty({
    description: 'User message sent to the AI',
    example: 'Hi',
  })
  @IsString()
  @MinLength(1)
  message!: string;
}
