import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

import { CallerStorage } from './caller.storage';
import { analyzeAnswer, isUserAskingQuestion } from './analyzer';
import { ConversationMemoryManager } from './conversation.memory';
import { evaluateConditionalFlow, type QuestionsFile } from './caller.flow';

@Injectable()
export class CallerService {
  private readonly callerDir =
    process.env.CALLER_DIR ?? path.resolve(process.cwd(), 'src', 'caller');

  private readonly questionsPath =
    process.env.QUESTIONS_PATH ?? path.resolve(this.callerDir, 'questions.json');

  private readonly storage = new CallerStorage(
    process.env.CALLER_DIR ?? path.resolve(__dirname)
  );

  private readonly llm = new ChatOpenAI({
    model: process.env.MODEL,
    apiKey: process.env.API_KEY,
    configuration: { baseURL: process.env.BASE_URL },
    temperature: 0,
  });

  private readonly memoryManager: ConversationMemoryManager;

  constructor() {
    this.memoryManager = new ConversationMemoryManager(this.llm);
  }

  async startConversation(
    usernameRaw: string
  ): Promise<string> {
    const username = this.sanitizeUsername(usernameRaw);

    await this.memoryManager.clearMemory(username);
    this.storage.clearConversationState(username);

    const script = this.loadFullScript();
    const greeting = script.intro.greeting
      .replace('{HOMEOWNER}', username);
    // Initialize memory and save greeting
    this.memoryManager.getOrCreateMemory(username);

// Set initial question index
    this.memoryManager.updateConversationData(username, {
      currentQuestionIndex: 0,
    });

    const firstQuestion = script.questions[0];
    const openingMessage = `${greeting}\n\n${firstQuestion}`;

    await this.memoryManager.addAIMessage(username, openingMessage);

    // Log the conversation start
    this.storage.appendLog(username, 0, firstQuestion, openingMessage, '');

    this.persistConversationState(username);

    return openingMessage;
  }

  async chat(
    usernameRaw: string,
    message: string
  ): Promise<string> {
    const username = this.sanitizeUsername(usernameRaw);

    const hasExistingConversation =
      this.memoryManager.hasMemory(username) ||
      this.storage.loadConversationState(username).currentQuestionIndex !== undefined;

    if (!hasExistingConversation) {
      return this.startConversation(username);
    }

    if (!this.memoryManager.hasMemory(username)) {
      await this.loadConversationState(username);
    }

    const script = this.loadFullScript();
    const questions = script.questions;

    if (!questions.length) {
      throw new InternalServerErrorException('No questions configured.');
    }

    const convData = this.memoryManager.getConversationData(username);
    const currentIdx = convData.currentQuestionIndex;
    const currentQuestion = currentIdx >= 0 && currentIdx < questions.length
      ? questions[currentIdx]
      : '(unknown question)';

    await this.memoryManager.addUserMessage(username, message);

    if (isUserAskingQuestion(message)) {
      const rebuttal = await this.handleRebuttal(message);
      if (rebuttal) {
        await this.memoryManager.addAIMessage(username, rebuttal);
        this.storage.appendLog(username, currentIdx, currentQuestion, rebuttal, message);
        this.persistConversationState(username);
        return rebuttal;
      }
    }

    let analysisResult: Awaited<ReturnType<typeof analyzeAnswer>> | undefined;
    if (currentIdx >= 0 && currentIdx < questions.length) {
      const answeredQuestion = questions[currentIdx];
      analysisResult = await analyzeAnswer(this.llm, answeredQuestion, message);

      convData.answers[`q${currentIdx}`] = message;
      this.memoryManager.updateConversationData(username, { answers: convData.answers });

      const conditionalResponse = await this.handleConditionalFlow(
        username,
        script,
        currentIdx,
        message
      );

      if (conditionalResponse) {
        await this.memoryManager.addAIMessage(username, conditionalResponse);
        // Log answer with analysis and AI response together
        this.storage.appendLog(username, currentIdx, answeredQuestion, conditionalResponse, message, analysisResult);
        this.persistConversationState(username);
        return conditionalResponse;
      }
    }

    const nextIdx = this.getNextQuestionIndex(username, questions.length);
    this.memoryManager.updateConversationData(username, { currentQuestionIndex: nextIdx });

    this.persistConversationState(username);

    if (nextIdx >= questions.length) {
      const closing = script.closing.thankYou;
      await this.memoryManager.addAIMessage(username, closing);
      // Log final answer with analysis and closing
      this.storage.appendLog(username, currentIdx, currentQuestion, closing, message, analysisResult);
      return closing;
    }

    const response = await this.formatQuestion(username, nextIdx, questions[nextIdx]);
    await this.memoryManager.addAIMessage(username, response);
    // Log answer with analysis and next question response together
    this.storage.appendLog(username, currentIdx, currentQuestion, response, message, analysisResult);

    return response;
  }

  async resetConversation(usernameRaw: string): Promise<void> {
    const username = this.sanitizeUsername(usernameRaw);
    await this.memoryManager.clearMemory(username);
    this.storage.clearConversationState(username);
  }

  private async handleConditionalFlow(
    username: string,
    script: QuestionsFile,
    questionIdx: number,
    answer: string
  ): Promise<string | null> {
    const convData = this.memoryManager.getConversationData(username);

    const result = evaluateConditionalFlow({
      script,
      questionIdx,
      answer,
      convData: {
        currentQuestionIndex: convData.currentQuestionIndex,
        answers: convData.answers,
        skipQuestions: convData.skipQuestions,
        interestedInSelling: convData.interestedInSelling,
      },
    });

    if (typeof result.interestedInSelling !== 'undefined') {
      this.memoryManager.updateConversationData(username, {
        interestedInSelling: result.interestedInSelling,
      });
    }

    if (result.skipQuestionsToAdd?.length) {
      const merged = Array.from(
        new Set([...(convData.skipQuestions ?? []), ...result.skipQuestionsToAdd])
      );
      this.memoryManager.updateConversationData(username, { skipQuestions: merged });
    }

    if (typeof result.nextQuestionIndex === 'number') {
      this.memoryManager.updateConversationData(username, {
        currentQuestionIndex: result.nextQuestionIndex,
      });
    }

    return result.response ?? null;
  }

  private getNextQuestionIndex(username: string, totalQuestions: number): number {
    const convData = this.memoryManager.getConversationData(username);
    let nextIdx = convData.currentQuestionIndex + 1;

    while (convData.skipQuestions.includes(nextIdx) && nextIdx < totalQuestions) {
      nextIdx++;
    }

    return nextIdx;
  }

  private async handleRebuttal(userQuestion: string): Promise<string | null> {
    const script = this.loadFullScript();
    const lowerQuestion = userQuestion.toLowerCase();

    const rebuttalMatches: Record<string, string[]> = {
      whereLocated: ['where are you located', 'where is your office', 'location'],
      personalLocation: ['where are you personally', 'where do you work from'],
      whoCallsBack: ['who will call', 'who is calling back', 'name of person'],
      callbackNumber: ['call back number', 'callback number', 'your number'],
      whatDoWithProperty: ['what do you do with', 'flip it', 'keep it', 'rent it'],
      renterConcern: ['what about the renter', 'tenant', 'what happens to'],
      whyCalling: ['why are you calling', 'why did you call'],
      scamSpam: ['scam', 'spam', 'suspicious'],
      website: ['website', 'web site', 'online'],
      wantsOfferNow: ['give me an offer', 'offer now', 'how much'],
      comeVisitFirst: ['come look', 'visit first', 'see the property'],
      whereGotNumber: ['where did you get my number', 'how did you get'],
      whatPublicRecords: ['public records', 'what records'],
      officeAddress: ['office address', 'address'],
      notEnoughMoney: ['not enough money', "can't afford", "don't have money"],
      checkInternet: ['check the internet', 'look online', 'zillow'],
    };

    for (const [key, keywords] of Object.entries(rebuttalMatches)) {
      if (keywords.some((kw) => lowerQuestion.includes(kw))) {
        return script.rebuttals[key] ?? null;
      }
    }

    return null;
  }

  private async formatQuestion(
    username: string,
    idx: number,
    question: string
  ): Promise<string> {
    // Get recent history from LangChain memory
    const historyContext = await this.memoryManager.getRecentHistory(username, 6);

    const res = await this.llm.invoke([
      new SystemMessage(
        `You are a professional real estate caller. Ask the next question naturally, acknowledging the conversation context.
Keep it conversational and professional. Do not add unnecessary words.

Recent conversation:
${historyContext}`
      ),
      new HumanMessage(`Ask this question naturally: ${question}`),
    ]);

    const text = (res.content ?? '').toString().trim();
    return text || `${idx + 1}) ${question}`;
  }

  // Persist LangChain memory data to storage
  private persistConversationState(username: string): void {
    const convData = this.memoryManager.getConversationData(username);
    this.storage.saveConversationState(username, {
      currentQuestionIndex: convData.currentQuestionIndex,
      answers: convData.answers,
      skipQuestions: convData.skipQuestions,
      interestedInSelling: convData.interestedInSelling,
    });
  }

  // Load conversation state from storage into LangChain memory
  private async loadConversationState(username: string): Promise<void> {
    const savedState = this.storage.loadConversationState(username);

    if (savedState.currentQuestionIndex !== undefined) {
      // Initialize memory
      this.memoryManager.getOrCreateMemory(username);

      // Restore conversation data
      this.memoryManager.updateConversationData(username, {
        currentQuestionIndex: savedState.currentQuestionIndex,
        answers: savedState.answers ?? {},
        skipQuestions: savedState.skipQuestions ?? [],
        interestedInSelling: savedState.interestedInSelling ?? null,
      });
    }
  }

  private loadFullScript(): QuestionsFile {
    try {
      const raw = fs.readFileSync(this.questionsPath, 'utf8');
      return JSON.parse(raw) as QuestionsFile;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new InternalServerErrorException(
        `Failed to read questions.json at "${this.questionsPath}": ${msg}`
      );
    }
  }

  private sanitizeUsername(username: string): string {
    const v = (username ?? '').trim();
    if (!v) return 'anonymous';
    return v.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
  }

}
