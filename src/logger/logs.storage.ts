import * as fs from "node:fs";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import { AnalysisResult } from "../caller/types";
import { GraphState, GraphLogEntry, ConversationNode } from "../graph/types";

export type UserState = {
  logPath?: string;
  currentQuestionIndex?: number;
  answers?: Record<string, string>;
  skipQuestions?: number[];
  interestedInSelling?: boolean | null;
};

@Injectable()
export class LogsStorage {
  private readonly baseDir: string;
  private readonly logsDir: string;
  private readonly stateDir: string;
  private readonly graphStateDir: string;

  constructor() {
    this.baseDir = process.env.CALLER_LOG_DIR ?? "./data/logs";
    this.logsDir = path.join(this.baseDir, "logs");
    this.stateDir = path.join(this.baseDir, "state");
    this.graphStateDir = path.join(this.baseDir, "graph-state");
    this.ensureDirs();
  }

  private ensureDirs(): void {
    [this.logsDir, this.stateDir, this.graphStateDir].forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  getStatePath(username: string) {
    return path.join(this.stateDir, `${username}.json`);
  }

  getLogPath(username: string) {
    const ts = new Date().toISOString().replace(/:/g, "-");
    return path.join(this.logsDir, `${username}.${ts}.log`);
  }

  readState(statePath: string): UserState {
    if (!fs.existsSync(statePath)) return {};
    try {
      const raw = fs.readFileSync(statePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<UserState>;
      return {
        logPath:
          typeof parsed.logPath === "string" ? parsed.logPath : undefined,
        currentQuestionIndex:
          typeof parsed.currentQuestionIndex === "number"
            ? parsed.currentQuestionIndex
            : undefined,
        answers: parsed.answers ?? {},
        skipQuestions: Array.isArray(parsed.skipQuestions)
          ? parsed.skipQuestions
          : [],
        interestedInSelling: parsed.interestedInSelling ?? null,
      };
    } catch {
      return {};
    }
  }

  writeState(statePath: string, state: UserState) {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
  }

  getCurrentQuestionIndex(usernameRaw: string): number {
    this.ensureDirs();
    const username = this.sanitizeUsername(usernameRaw);
    const statePath = this.getStatePath(username);
    const state = this.readState(statePath);
    return state.currentQuestionIndex ?? -1;
  }

  updateQuestionIndex(usernameRaw: string, questionIndex: number): void {
    this.ensureDirs();
    const username = this.sanitizeUsername(usernameRaw);
    const statePath = this.getStatePath(username);
    const state = this.readState(statePath);
    state.currentQuestionIndex = questionIndex;
    this.writeState(statePath, state);
  }

  saveConversationState(
    usernameRaw: string,
    data: {
      currentQuestionIndex: number;
      answers: Record<string, string>;
      skipQuestions: number[];
      interestedInSelling: boolean | null;
    }
  ): void {
    this.ensureDirs();
    const username = this.sanitizeUsername(usernameRaw);
    const statePath = this.getStatePath(username);
    const state = this.readState(statePath);

    state.currentQuestionIndex = data.currentQuestionIndex;
    state.answers = data.answers;
    state.skipQuestions = data.skipQuestions;
    state.interestedInSelling = data.interestedInSelling;

    if (!state.logPath) {
      state.logPath = this.getLogPath(username);
    }

    this.writeState(statePath, state);
  }

  loadConversationState(usernameRaw: string): UserState {
    this.ensureDirs();
    const username = this.sanitizeUsername(usernameRaw);
    const statePath = this.getStatePath(username);
    return this.readState(statePath);
  }

  clearConversationState(usernameRaw: string): void {
    this.ensureDirs();
    const username = this.sanitizeUsername(usernameRaw);
    const statePath = this.getStatePath(username);
    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }
  }

  appendLog(
    username: string,
    questionIndex: number,
    questionText: string,
    aiResponse: string,
    userMessage: string,
    analysisResult?: AnalysisResult
  ): void {
    this.ensureDirs();
    const state = this.loadConversationState(username);

    if (!state.logPath) {
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      state.logPath = path.join(this.logsDir, `${username}.${timestamp}.log`);

      // Save the log path to state
      const statePath = this.getStatePath(this.sanitizeUsername(username));
      this.writeState(statePath, state);
    }

    try {
      // Ensure logs directory exists
      fs.mkdirSync(path.dirname(state.logPath), { recursive: true });

      const timestamp = new Date().toISOString();
      let logEntry = `[${timestamp}] Q${questionIndex}: ${questionText}\n`;

      if (userMessage) {
        logEntry += `  Full Answer: ${userMessage}\n`;
      }
      if (aiResponse) {
        logEntry += `  AI Response: ${aiResponse}\n`;
      }

      if (analysisResult) {
        const { data } = analysisResult;
        const extractedValueStr = typeof data.extractedValue === 'object'
          ? JSON.stringify(data.extractedValue)
          : String(data.extractedValue);

        logEntry += `  Extracted Value: ${extractedValueStr}\n`;
        logEntry += `  Value Type: ${data.valueType}\n`;
        logEntry += `  Extraction Success: ${analysisResult.success}\n`;

        if (data.metadata) {
          if (data.metadata.details) {
            logEntry += `  Details: ${data.metadata.details}\n`;
          }
          if (data.metadata.amountOwed !== undefined && data.metadata.amountOwed !== null) {
            logEntry += `  Amount Owed: $${data.metadata.amountOwed}\n`;
          }
          if (data.metadata.daysEstimate !== undefined && data.metadata.daysEstimate !== null) {
            logEntry += `  Days Estimate: ${data.metadata.daysEstimate}\n`;
          }
          if (data.metadata.realtorName) {
            logEntry += `  Realtor: ${data.metadata.realtorName}\n`;
          }
        }

        if (analysisResult.error) {
          logEntry += `  Error: ${analysisResult.error}\n`;
        }
      }

      logEntry += "\n";

      fs.appendFileSync(state.logPath, logEntry, "utf8");
      console.log(logEntry);
    } catch (error) {
      console.error(`[ERROR] Failed to write log:`, error);
    }
  }

  logAnswer(params: {
    usernameRaw: string;
    questions: string[];
    answer: string;
    questionNumber?: number;
    analysisResult?: AnalysisResult;
  }) {
    const qNum = params.questionNumber ?? -1;
    const qText =
      typeof qNum === "number" && Number.isFinite(qNum) && qNum >= 0
        ? params.questions[qNum]
        : "(unknown question)";

    this.appendLog(
      params.usernameRaw,
      qNum,
      qText,
      "",
      params.answer,
      params.analysisResult
    );
  }

  listLogFiles(): Array<{ name: string; updatedAt: string; size: number }> {
    this.ensureDirs();

    if (!fs.existsSync(this.logsDir)) return [];

    return fs
      .readdirSync(this.logsDir)
      .filter((name) => name.endsWith('.log') || name.endsWith('.txt') || name.endsWith('.jsonl'))
      .map((name) => {
        const fullPath = path.join(this.logsDir, name);
        const st = fs.statSync(fullPath);
        return { name, updatedAt: new Date(st.mtimeMs).toISOString(), size: st.size };
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  readLogFile(filename: string): string {
    this.ensureDirs();

    // Prevent traversal & only allow known files (now list returns objects)
    const allowed = new Set(this.listLogFiles().map((f) => f.name));
    if (!allowed.has(filename)) {
      throw new Error('Log file not found.');
    }

    const fullPath = path.resolve(this.logsDir, filename);
    return fs.readFileSync(fullPath, 'utf8');
  }

  private sanitizeUsername(username: string) {
    const v = (username ?? "").trim();
    if (!v) return "anonymous";
    return v.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
  }

  // ─── Graph State Management ───────────────────────────────────────────

  private getGraphStatePath(username: string): string {
    return path.join(this.graphStateDir, `${this.sanitizeUsername(username)}.json`);
  }

  private getGraphLogPath(username: string): string {
    const sanitized = this.sanitizeUsername(username);
    const ts = new Date().toISOString().replace(/:/g, "-");
    return path.join(this.logsDir, `graph.${sanitized}.${ts}.log`);
  }

  saveGraphState(state: GraphState): void {
    const statePath = this.getGraphStatePath(state.username);
    const stateToSave = {
      ...state,
      logPath: this.getOrCreateGraphLogPath(state.username),
    };
    fs.writeFileSync(statePath, JSON.stringify(stateToSave, null, 2), "utf8");
  }

  loadGraphState(username: string): GraphState | null {
    const statePath = this.getGraphStatePath(username);
    if (!fs.existsSync(statePath)) return null;

    try {
      const raw = fs.readFileSync(statePath, "utf8");
      return JSON.parse(raw) as GraphState;
    } catch {
      return null;
    }
  }

  clearGraphState(username: string): void {
    const statePath = this.getGraphStatePath(username);
    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }
  }

  private getOrCreateGraphLogPath(username: string): string {
    const state = this.loadGraphState(username);
    if (state && (state as any).logPath) {
      return (state as any).logPath;
    }
    return this.getGraphLogPath(username);
  }

  appendGraphLog(
    username: string,
    node: ConversationNode,
    question: string,
    userResponse: string,
    extractedValue: any,
    nextNode: ConversationNode,
    aiResponse?: string // Add optional AI response parameter
  ): void {
    const logPath = this.getOrCreateGraphLogPath(username);

    const entry: GraphLogEntry = {
      timestamp: new Date().toISOString(),
      node,
      question,
      userResponse,
      extractedValue,
      nextNode,
    };

    const extractedValueStr = typeof extractedValue === 'object'
      ? JSON.stringify(extractedValue, null, 2)
      : String(extractedValue);

    let logLine = `[${entry.timestamp}] Node: ${node}
  Question: ${question}
  User Response: ${userResponse}
  Extracted Value: ${extractedValueStr}
  Next Node: ${nextNode}`;

    if (aiResponse) {
      logLine += `\n  AI Response: ${aiResponse}`;
    }

    logLine += `\n----------------------------------------\n`;

    // Always log to console for visibility
    console.log(`\n[API CHAT LOG] ==========================================`);
    console.log(`[API CHAT LOG] Timestamp: ${entry.timestamp}`);
    console.log(`[API CHAT LOG] Username: ${username}`);
    console.log(`[API CHAT LOG] Current Node: ${node}`);
    console.log(`[API CHAT LOG] Question: ${question}`);
    console.log(`[API CHAT LOG] User Response: ${userResponse}`);
    console.log(`[API CHAT LOG] Extracted Value:`, extractedValueStr);
    console.log(`[API CHAT LOG] Next Node: ${nextNode}`);
    if (aiResponse) {
      console.log(`[API CHAT LOG] AI Response: ${aiResponse}`);
    }
    console.log(`[API CHAT LOG] Log File: ${logPath}`);
    console.log(`[API CHAT LOG] ==========================================\n`);

    try {
      // Ensure directory exists
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, logLine, "utf8");
    } catch (error) {
      console.error(`[GraphLog ERROR] Failed to write log to ${logPath}:`, error);
    }
  }

  appendGraphSummary(username: string, state: GraphState): void {
    const logPath = this.getOrCreateGraphLogPath(username);
    const timestamp = new Date().toISOString();

    let summaryLog = `
========================================
[${timestamp}] CONVERSATION SUMMARY
========================================
Username: ${username}
Completed: ${state.isComplete}

--- RAW ANSWERS ---
`;

    for (const [node, answer] of Object.entries(state.answers || {})) {
      summaryLog += `${node}: "${answer}"\n`;
    }

    summaryLog += `
--- EXTRACTED VALUES ---
`;

    for (const [node, value] of Object.entries((state as any).extractedAnswers || {})) {
      const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
      summaryLog += `${node}: ${valueStr}\n`;
    }

    summaryLog += `
--- STATE FLAGS ---
interestedInSelling: ${state.interestedInSelling}
hasOtherProperty: ${state.hasOtherProperty}
isTenantOccupied: ${state.isTenantOccupied}
isAnnualLease: ${state.isAnnualLease}
email: ${state.email}
========================================

`;

    try {
      fs.appendFileSync(logPath, summaryLog, "utf8");
      console.log(`[GraphLog] Summary saved for ${username}`);
    } catch (error) {
      console.error(`[GraphLog ERROR] Failed to write summary:`, error);
    }
  }
}
