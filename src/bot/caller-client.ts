import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { AppModule } from '../app.module';

import { GraphService } from '../graph/graph.service';

export interface CallerClient {
  chat(username: string, message: string): Promise<string>;
  reset(username: string): Promise<void>;
  close(): Promise<void>;
}

function normalizeReply(text: unknown): string {
  if (typeof text !== 'string') return JSON.stringify(text);
  const t = text.trim();
  if (t.startsWith('"') && t.endsWith('"')) {
    try {
      return JSON.parse(t);
    } catch {
      return t.slice(1, -1);
    }
  }
  return t;
}

export async function createCallerClient(appCtx?: INestApplicationContext): Promise<CallerClient> {
  const app =
    appCtx ??
    (await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn'] // keep bot output clean
    }));

  const caller = app.get(GraphService);

  return {
    async chat(username, message) {
      const res = await caller.chat(username, message);
      return normalizeReply(res);
    },
    async reset(username) {
      await caller.resetConversation(username);
    },
    async close() {
      await app.close();
    }
  };
}
