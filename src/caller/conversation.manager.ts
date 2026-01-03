// import { ChatOpenAI } from "@langchain/openai";
// import { ConversationChain } from "langchain/chains";
// import { BufferMemory } from "langchain/memory";
// import { PromptTemplate } from "@langchain/core/prompts";
// import { loadQuestionsFromJson } from "./questions.config";

// export interface ConversationState {
//   currentQuestionIndex: number;
//   answers: Map<string, string>;
//   isComplete: boolean;
// }

// export class ConversationManager {
//   private memory: BufferMemory;
//   private chain: ConversationChain;
//   private state: ConversationState;
//   private questions: string[];

//   constructor(apiKey: string) {
//     const llm = new ChatOpenAI({
//       openAIApiKey: apiKey,
//       modelName: "gpt-3.5-turbo",
//       temperature: 0.7,
//     });

//     this.memory = new BufferMemory({
//       memoryKey: "history",
//       returnMessages: true,
//     });

//     const prompt = PromptTemplate.fromTemplate(`
// You are a helpful assistant conducting a structured interview.
// Use the conversation history to maintain context and ask follow-up questions naturally.

// Conversation history:
// {history}

// Current question to ask: {input}

// Respond naturally, acknowledging previous answers when relevant.
// `);

//     this.chain = new ConversationChain({
//       llm,
//       memory: this.memory,
//       prompt,
//     });

//     this.questions = loadQuestionsFromJson();

//     this.state = {
//       currentQuestionIndex: 0,
//       answers: new Map(),
//       isComplete: false,
//     };
//   }

//   getCurrentQuestion(): string | null {
//     if (this.state.currentQuestionIndex >= this.questions.length) {
//       this.state.isComplete = true;
//       return null;
//     }
//     return this.questions[this.state.currentQuestionIndex];
//   }

//   async askCurrentQuestion(): Promise<string> {
//     const question = this.getCurrentQuestion();
//     if (!question) {
//       return "Thank you! All questions have been answered.";
//     }

//     const response = await this.chain.call({
//       input: question,
//     });

//     return response.response as string;
//   }

//   async processAnswer(userAnswer: string): Promise<{
//     nextQuestion: string | null;
//     isComplete: boolean;
//   }> {
//     const currentQuestion = this.getCurrentQuestion();
//     if (currentQuestion) {
//       this.state.answers.set(
//         `q${this.state.currentQuestionIndex}`,
//         userAnswer
//       );
//     }

//     await this.memory.saveContext(
//       { input: currentQuestion || "" },
//       { output: userAnswer }
//     );

//     this.state.currentQuestionIndex++;

//     const nextQuestion = this.getCurrentQuestion();
//     if (!nextQuestion) {
//       return { nextQuestion: null, isComplete: true };
//     }

//     const response = await this.askCurrentQuestion();
//     return { nextQuestion: response, isComplete: false };
//   }

//   getAnswers(): Record<string, string> {
//     return Object.fromEntries(this.state.answers);
//   }

//   getState(): ConversationState {
//     return { ...this.state };
//   }

//   getQuestions(): string[] {
//     return this.questions;
//   }

//   async getConversationSummary(): Promise<string> {
//     const history = await this.memory.loadMemoryVariables({});
//     return JSON.stringify(history, null, 2);
//   }
// }
