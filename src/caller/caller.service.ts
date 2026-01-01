import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

import { CallerStorage } from './caller.storage';

type QuestionsFile = { questions: string[] };

@Injectable()
export class CallerService {
  private readonly callerDir =
    process.env.CALLER_DIR ?? path.resolve(process.cwd(), 'src', 'caller');

  private readonly questionsPath =
    process.env.QUESTIONS_PATH ?? path.resolve(this.callerDir, 'questions.json');

  private readonly storage = new CallerStorage(this.callerDir);

  private readonly llm = new ChatOpenAI({
    model: process.env.MODEL ,
    apiKey: process.env.API_KEY,
    configuration: { baseURL: process.env.BASE_URL },
    temperature: 0,
  });

  async chat(usernameRaw: string, message: string, questionNum?: number): Promise<string> {
    const questions = this.loadQuestions();
    if (!questions.length) throw new InternalServerErrorException('No questions configured.');

    this.storage.logAnswer({
      usernameRaw,
      questions,
      answer: message,
      questionNumber: questionNum,
    });

    // Determine next question from questionNum (0-based)
    const lastAnsweredIdx =
      typeof questionNum === 'number' && Number.isFinite(questionNum) && questionNum >= 0
        ? questionNum
        : -1;

    const nextIdx = lastAnsweredIdx + 1;

    if (nextIdx >= questions.length) {
      return 'Thanks. All questions are completed.';
    }

    return this.formatQuestion(nextIdx, questions[nextIdx]);
  }

  private loadQuestions(): string[] {
    try {
      const raw = fs.readFileSync(this.questionsPath, 'utf8');
      const parsed = JSON.parse(raw) as QuestionsFile;
      return Array.isArray(parsed.questions) ? parsed.questions : [];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new InternalServerErrorException(
        `Failed to read questions.json at "${this.questionsPath}": ${msg}`,
      );
    }
  }

  private async formatQuestion(idx: number, q: string): Promise<string> {
    const res = await this.llm.invoke([
      new SystemMessage(
        'You are a caller script. Return ONLY the next question as plain text, prefixed with "{n}) ". Do not add extra words.',
      ),
      new HumanMessage(`n=${idx}\nquestion=${q}`),
    ]);
    const text = (res.content ?? '').toString().trim();
    return text || `${idx}) ${q}`;
  }
}
