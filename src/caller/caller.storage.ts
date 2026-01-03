import * as fs from "node:fs";
import * as path from "node:path";
import { AnalysisResult } from "./types";

export type UserState = {
  logPath?: string;
  currentQuestionIndex?: number;
  answers?: Record<string, string>;
  skipQuestions?: number[];
  interestedInSelling?: boolean | null;
};

export class CallerStorage {
  private readonly logsDir: string;
  private readonly stateDir: string;

  constructor(private readonly baseDir: string) {
    this.logsDir = path.join(this.baseDir, "logs");
    this.stateDir = path.join(this.baseDir, "state");
  }

  ensureDirs() {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }
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
      console.log(`[DEBUG] Log written to: ${state.logPath}`);
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
}
