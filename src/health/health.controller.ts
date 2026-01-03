import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOkResponse({
    description: 'Basic liveness check',
    schema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean', example: true },
        uptime: { type: 'number', example: 123.45 },
        timestamp: { type: 'string', example: '2026-01-03T12:34:56.789Z' }
      }
    }
  })
  health() {
    return {
      ok: true,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  }
}
