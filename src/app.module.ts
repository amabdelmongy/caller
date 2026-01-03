import { Module } from '@nestjs/common';
import { CallerModule } from './caller/caller.module';
import { LogsController } from './caller/logs.controller';
import { HealthController } from './health/health.controller';

import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import swaggerUiDist from 'swagger-ui-dist';

@Module({
  imports: [
    CallerModule,

    // Serve Swagger UI assets so /swagger/swagger-ui*.js|css resolve in prod
    ServeStaticModule.forRoot({
      rootPath: join(swaggerUiDist.getAbsoluteFSPath()),
      serveRoot: '/swagger',
      exclude: ['/swagger', '/swagger/'],
    }),
  ],
  controllers: [LogsController, HealthController],
})
export class AppModule {}
