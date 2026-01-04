import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";

export class GraphChatRequestDto {
  @ApiProperty({ example: "Ahmed" + new Date().getUTCMinutes()+"" + new Date().getUTCSeconds() })
  @IsString()
  @MinLength(1)
  username!: string;

  @ApiProperty({
    description: "User message sent to the AI",
    example: "Yes, I am interested in selling",
  })
  @IsString()
  @MinLength(1)
  message!: string;
}

export class GraphStartRequestDto {
  @ApiProperty({ example: "Ahmed"+ new Date().getUTCMinutes()+"" + new Date().getUTCSeconds() })
  @IsString()
  @MinLength(1)
  username!: string;
}
