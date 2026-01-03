import { BufferMemory, ConversationSummaryMemory } from "langchain/memory";
import { ChatOpenAI } from "@langchain/openai";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";
import { HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";

export interface ConversationData {
  currentQuestionIndex: number;
  answers: Record<string, string>;
  interestedInSelling: boolean | null;
  skipQuestions: number[];
}

export class ConversationMemoryManager {
  private memories = new Map<string, BufferMemory>();
  private conversationData = new Map<string, ConversationData>();
  private llm: ChatOpenAI;

  constructor(llm: ChatOpenAI) {
    this.llm = llm;
  }

  getOrCreateMemory(username: string): BufferMemory {
    if (!this.memories.has(username)) {
      const chatHistory = new ChatMessageHistory();

      this.memories.set(
        username,
        new BufferMemory({
          memoryKey: "history",
          chatHistory,
          returnMessages: true,
          inputKey: "input",
          outputKey: "output",
        })
      );

      // Initialize conversation data
      this.conversationData.set(username, {
        currentQuestionIndex: -1,
        answers: {},
        interestedInSelling: null,
        skipQuestions: [],
      });
    }
    return this.memories.get(username)!;
  }

  // Use summary memory for long conversations to save tokens
  async createSummaryMemory(username: string): Promise<ConversationSummaryMemory> {
    return new ConversationSummaryMemory({
      memoryKey: "history",
      llm: this.llm,
      returnMessages: true,
    });
  }

  getConversationData(username: string): ConversationData {
    if (!this.conversationData.has(username)) {
      this.conversationData.set(username, {
        currentQuestionIndex: -1,
        answers: {},
        interestedInSelling: null,
        skipQuestions: [],
      });
    }
    return this.conversationData.get(username)!;
  }

  updateConversationData(username: string, data: Partial<ConversationData>): void {
    const existing = this.getConversationData(username);
    this.conversationData.set(username, { ...existing, ...data });
  }

  async addUserMessage(username: string, message: string): Promise<void> {
    const memory = this.getOrCreateMemory(username);
    await memory.chatHistory.addMessage(new HumanMessage(message));
  }

  async addAIMessage(username: string, message: string): Promise<void> {
    const memory = this.getOrCreateMemory(username);
    await memory.chatHistory.addMessage(new AIMessage(message));
  }

  async saveContext(
    username: string,
    input: string,
    output: string
  ): Promise<void> {
    const memory = this.getOrCreateMemory(username);
    await memory.saveContext({ input }, { output });
  }

  async getHistory(username: string): Promise<BaseMessage[]> {
    const memory = this.getOrCreateMemory(username);
    const messages = await memory.chatHistory.getMessages();
    return messages;
  }

  async getHistoryString(username: string): Promise<string> {
    const messages = await this.getHistory(username);
    return messages
      .map((m) => {
        const role = m._getType() === "human" ? "Homeowner" : "Agent";
        return `${role}: ${m.content}`;
      })
      .join("\n");
  }

  async getRecentHistory(username: string, lastN: number = 6): Promise<string> {
    const messages = await this.getHistory(username);
    return messages
      .slice(-lastN)
      .map((m) => {
        const role = m._getType() === "human" ? "Homeowner" : "Agent";
        return `${role}: ${m.content}`;
      })
      .join("\n");
  }

  async clearMemory(username: string): Promise<void> {
    const memory = this.memories.get(username);
    if (memory) {
      await memory.clear();
    }
    this.memories.delete(username);
    this.conversationData.delete(username);
  }

  hasMemory(username: string): boolean {
    return this.memories.has(username);
  }

  // Export conversation data for persistence
  exportData(username: string): {
    conversationData: ConversationData;
    messageCount: number;
  } | null {
    const data = this.conversationData.get(username);
    const memory = this.memories.get(username);

    if (!data) return null;

    return {
      conversationData: data,
      messageCount: 0, // Will be updated when we get messages
    };
  }

  // Import conversation data from persistence
  async importData(
    username: string,
    data: ConversationData,
    messages: Array<{ role: "human" | "ai"; content: string }>
  ): Promise<void> {
    this.conversationData.set(username, data);

    const memory = this.getOrCreateMemory(username);

    for (const msg of messages) {
      if (msg.role === "human") {
        await memory.chatHistory.addMessage(new HumanMessage(msg.content));
      } else {
        await memory.chatHistory.addMessage(new AIMessage(msg.content));
      }
    }
  }
}
