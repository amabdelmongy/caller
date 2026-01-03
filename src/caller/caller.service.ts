import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

import { CallerStorage } from './caller.storage';
import { analyzeAnswer, isUserAskingQuestion, detectInterestLevel } from './analyzer';
import { ConversationMemoryManager } from './conversation.memory';

type ConditionalFlow = {
  followUp?: string;
  noAgain?: string;
  annual?: string;
};

type QuestionsFile = {
  intro: { greeting: string };
  questions: string[];
  conditionalFlows: {
    initialResponse: { no: ConditionalFlow; yes: ConditionalFlow };
    priceNegotiable: { yes: ConditionalFlow };
    tenantOccupied: { yes: ConditionalFlow };
  };
  rebuttals: Record<string, string>;
  closing: {
    thankYou: string;
    interestScale: string;
    interestThreshold: { low: string; high: string };
  };
  reminders: string[];
};

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

  // Use LangChain memory manager
  private readonly memoryManager: ConversationMemoryManager;

  constructor() {
    this.memoryManager = new ConversationMemoryManager(this.llm);
  }

  async startConversation(
    usernameRaw: string,
    homeowner: string,
    agentName: string,
    propertyAddress: string
  ): Promise<string> {
    const username = this.sanitizeUsername(usernameRaw);

    // Clear any existing memory for fresh start
    await this.memoryManager.clearMemory(username);
    this.storage.clearConversationState(username);

    const script = this.loadFullScript();
    const greeting = script.intro.greeting
      .replace('{HOMEOWNER}', homeowner)
      .replace('{AGENT_NAME}', agentName)
      .replace('{PROPERTY_ADDRESS}', propertyAddress);

    // Initialize memory and save greeting
    this.memoryManager.getOrCreateMemory(username);
    await this.memoryManager.addAIMessage(username, greeting);

    // Set initial question index
    this.memoryManager.updateConversationData(username, {
      currentQuestionIndex: 0,
    });

    // Persist to storage
    this.persistConversationState(username);

    return greeting;
  }

  async chat(usernameRaw: string, message: string): Promise<string> {
    console.log(`[DEBUG] chat called - username: ${usernameRaw}, message: ${message}`);

    const username = this.sanitizeUsername(usernameRaw);

    // Load from storage if memory doesn't exist
    if (!this.memoryManager.hasMemory(username)) {
      await this.loadConversationState(username);
    }

    const script = this.loadFullScript();
    const questions = script.questions;

    if (!questions.length) {
      throw new InternalServerErrorException('No questions configured.');
    }

    // Add user message to memory
    await this.memoryManager.addUserMessage(username, message);

    // Check if user is asking a question (handle rebuttals)
    if (isUserAskingQuestion(message)) {
      const rebuttal = await this.handleRebuttal(username, message);
      if (rebuttal) {
        await this.memoryManager.addAIMessage(username, rebuttal);
        this.persistConversationState(username);
        return rebuttal;
      }
    }

    // Get conversation data
    const convData = this.memoryManager.getConversationData(username);
    const currentIdx = convData.currentQuestionIndex;
    console.log(`[DEBUG] currentQuestionIndex: ${currentIdx}`);

    // Analyze the answer
    let analysisResult;
    if (currentIdx >= 0 && currentIdx < questions.length) {
      const answeredQuestion = questions[currentIdx];
      console.log(`[DEBUG] Analyzing answer for question: ${answeredQuestion}`);
      analysisResult = await analyzeAnswer(this.llm, answeredQuestion, message);
      console.log(`[DEBUG] Analysis result:`, analysisResult);

      // Store the answer
      convData.answers[`q${currentIdx}`] = message;
      this.memoryManager.updateConversationData(username, { answers: convData.answers });

      // Handle conditional flows based on answer
      const conditionalResponse = await this.handleConditionalFlow(
        username,
        script,
        currentIdx,
        message,
        analysisResult
      );

      if (conditionalResponse) {
        await this.memoryManager.addAIMessage(username, conditionalResponse);
        this.persistConversationState(username);
        return conditionalResponse;
      }
    }

    // Log the answer
    this.storage.logAnswer({
      usernameRaw,
      questions,
      answer: message,
      questionNumber: currentIdx,
      analysisResult,
    });

    // Get next question
    const nextIdx = this.getNextQuestionIndex(username, questions.length);
    this.memoryManager.updateConversationData(username, { currentQuestionIndex: nextIdx });

    // Persist state
    this.persistConversationState(username);

    if (nextIdx >= questions.length) {
      const closing = script.closing.thankYou;
      await this.memoryManager.addAIMessage(username, closing);
      return closing;
    }

    const response = await this.formatQuestion(username, nextIdx, questions[nextIdx]);
    await this.memoryManager.addAIMessage(username, response);

    return response;
  }

  private async handleConditionalFlow(
    username: string,
    script: QuestionsFile,
    questionIdx: number,
    answer: string,
    analysisResult: any
  ): Promise<string | null> {
    const convData = this.memoryManager.getConversationData(username);
    const lowerAnswer = answer.toLowerCase();
    const isNegative = /\b(no|nope|not really|never|don't think so)\b/.test(lowerAnswer);
    const isPositive = /\b(yes|yeah|sure|definitely|absolutely|maybe|possibly)\b/.test(lowerAnswer);

    // Q0: Have you ever considered selling?
    if (questionIdx === 0) {
      this.memoryManager.updateConversationData(username, { interestedInSelling: isPositive });

      if (isNegative) {
        this.memoryManager.updateConversationData(username, { currentQuestionIndex: 1 });
        return script.conditionalFlows.initialResponse.no.followUp ?? null;
      } else if (isPositive) {
        convData.skipQuestions.push(1, 2);
        this.memoryManager.updateConversationData(username, {
          skipQuestions: convData.skipQuestions,
          currentQuestionIndex: 3,
        });
        return `${script.conditionalFlows.initialResponse.yes.followUp}\n\n${script.questions[3]}`;
      }
    }

    // Q1: Consider in near future?
    if (questionIdx === 1 && isNegative) {
      this.memoryManager.updateConversationData(username, { currentQuestionIndex: 2 });
      return script.conditionalFlows.initialResponse.no.noAgain ?? null;
    }

    // Q4: Is price negotiable?
    if (questionIdx === 4 && isPositive) {
      this.memoryManager.updateConversationData(username, { currentQuestionIndex: 5 });
      return script.conditionalFlows.priceNegotiable.yes.followUp ?? null;
    }

    // Q15: Property occupied by tenants?
    if (questionIdx === 15 && /\b(tenant|renter|rent)\b/.test(lowerAnswer)) {
      this.memoryManager.updateConversationData(username, { currentQuestionIndex: 16 });
      return script.conditionalFlows.tenantOccupied.yes.followUp ?? null;
    }

    // Q16: Monthly or annual lease?
    if (questionIdx === 16 && /\b(annual|yearly|year)\b/.test(lowerAnswer)) {
      this.memoryManager.updateConversationData(username, { currentQuestionIndex: 17 });
      return script.conditionalFlows.tenantOccupied.yes.annual ?? null;
    }

    // Skip tenant questions if owner-occupied
    if (questionIdx === 15 && /\b(me|myself|i live|owner)\b/.test(lowerAnswer)) {
      convData.skipQuestions.push(16, 17);
      this.memoryManager.updateConversationData(username, { skipQuestions: convData.skipQuestions });
    }

    return null;
  }

  private getNextQuestionIndex(username: string, totalQuestions: number): number {
    const convData = this.memoryManager.getConversationData(username);
    let nextIdx = convData.currentQuestionIndex + 1;

    while (convData.skipQuestions.includes(nextIdx) && nextIdx < totalQuestions) {
      nextIdx++;
    }

    return nextIdx;
  }

  async handleRebuttal(username: string, userQuestion: string): Promise<string | null> {
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
      notEnoughMoney: ['not enough money', 'can\'t afford', 'don\'t have money'],
      checkInternet: ['check the internet', 'look online', 'zillow'],
    };

    for (const [key, keywords] of Object.entries(rebuttalMatches)) {
      if (keywords.some(kw => lowerQuestion.includes(kw))) {
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
        `Failed to read questions.json at "${this.questionsPath}": ${msg}`,
      );
    }
  }

  getReminders(): string[] {
    return this.loadFullScript().reminders;
  }

  getClosingScript(): string {
    return this.loadFullScript().closing.thankYou;
  }

  getIntroGreeting(homeowner: string, agentName: string, propertyAddress: string): string {
    const script = this.loadFullScript();
    return script.intro.greeting
      .replace('{HOMEOWNER}', homeowner)
      .replace('{AGENT_NAME}', agentName)
      .replace('{PROPERTY_ADDRESS}', propertyAddress);
  }

  async clearUserContext(usernameRaw: string): Promise<void> {
    const username = this.sanitizeUsername(usernameRaw);
    await this.memoryManager.clearMemory(username);
    this.storage.clearConversationState(username);
  }

  getUserAnswers(usernameRaw: string): Record<string, string> {
    const username = this.sanitizeUsername(usernameRaw);
    return this.memoryManager.getConversationData(username).answers;
  }

  async getConversationHistory(usernameRaw: string): Promise<string> {
    const username = this.sanitizeUsername(usernameRaw);
    return this.memoryManager.getHistoryString(username);
  }

  private sanitizeUsername(username: string): string {
    const v = (username ?? '').trim();
    if (!v) return 'anonymous';
    return v.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
  }
}
