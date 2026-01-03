import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiOkResponse,
  ApiProduces,
} from '@nestjs/swagger';
import { ChatRequestDto } from './dto/chat.dto';
import { CallerService } from './caller.service';

@ApiTags('chat')
@Controller('chat')
export class CallerController {
  constructor(private readonly callerService: CallerService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a message to AI' })
  @ApiBody({ type: ChatRequestDto })
  @ApiProduces('text/plain')
  @ApiOkResponse({
    description: 'AI response received successfully (plain text)',
    schema: { type: 'string', example: ' Have you ever considered or had any intention of selling before?' },
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async chat(@Body() dto: ChatRequestDto): Promise<string> {
    return this.callerService.chat(dto.username, dto.message);
  }
}
