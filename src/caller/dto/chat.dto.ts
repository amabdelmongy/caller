import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class ChatRequestDto {
  @ApiProperty({ example: 'anonymous' })
  @IsString()
  @MinLength(1)
  username!: string;

  @ApiProperty({
    description: 'User message sent to the AI',
    example: 'What is?',
  })
  @IsString()
  @MinLength(1)
  message!: string;

  @ApiProperty({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  questionNum?: number;
}
