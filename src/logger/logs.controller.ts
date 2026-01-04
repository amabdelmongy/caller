import { Controller, Get, Param, NotFoundException, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CallerStorage } from '../caller/caller.storage';

@Controller('logs')
export class LogsController {
  private readonly storage = new CallerStorage();

  @Get()
  list() {
    return { files: this.storage.listLogFiles() };
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
