import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiOkResponse,
  ApiProduces,
} from "@nestjs/swagger";
import { GraphService } from "./graph.service";
import { LogsStorage } from "../logger/logs.storage";
import { GraphChatRequestDto, GraphStartRequestDto } from "./dto/graph-chat.dto";

@ApiTags("graph")
@Controller("graph")
export class GraphController {
  constructor(
    private readonly graphService: GraphService,
    private readonly logsStorage: LogsStorage
  ) {}

  @Post("chat")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Send a message in graph-based conversation" })
  @ApiBody({ type: GraphChatRequestDto })
  @ApiProduces("text/plain")
  @ApiOkResponse({
    description: "AI response received successfully",
    schema: { type: "string" },
  })
  @ApiResponse({ status: 400, description: "Bad request" })
  async chat(@Body() dto: GraphChatRequestDto): Promise<string> {
    return this.graphService.chat(dto.username, dto.message);
  }

  @Post("reset")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Reset graph conversation state" })
  @ApiBody({
    schema: {
      type: "object",
      properties: { username: { type: "string", example: "JohnDoe" } },
      required: ["username"],
    },
  })
  async reset(@Body("username") username: string): Promise<{ ok: true }> {
    await this.graphService.resetConversation(username);
    return { ok: true };
  }

  @Get("state/:username")
  @ApiOperation({ summary: "Get current conversation state" })
  @ApiResponse({ status: 200, description: "Current state" })
  @ApiResponse({ status: 404, description: "No active conversation" })
  async getState(@Param("username") username: string) {
    const state = this.graphService.getConversationState(username);
    if (!state) {
      return { active: false, message: "No active conversation" };
    }
    return {
      active: true,
      currentNode: state.currentNode,
      isComplete: state.isComplete,
      answers: state.answers,
      messageCount: state.messages.length,
    };
  }
}
