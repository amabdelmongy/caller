import { Controller, Get, Param, NotFoundException, Res, Req } from '@nestjs/common';
import type { Response, Request } from 'express';
import { CallerStorage } from './caller.storage';

@Controller('logs')
export class LogsController {
  private readonly storage = new CallerStorage();

  @Get()
  list(@Req() req: Request) {
    const files = this.storage.listLogFiles();

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    return {
      files: files.map((f) => ({
        ...f,
        url: `${baseUrl}/logs/${encodeURIComponent(f.name)}`,
      })),
    };
  }

  @Get(':filename')
  read(@Param('filename') filename: string, @Res() res: Response) {
    try {
      const content = this.storage.readLogFile(filename);

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      // Optional:
      // res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

      return res.send(content);
    } catch {
      throw new NotFoundException('Log file not found');
    }
  }
}
