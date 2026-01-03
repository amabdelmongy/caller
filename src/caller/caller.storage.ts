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
    logPath: string,
    num: number,
    question: string,
    answer: string,
    analysisResult?: AnalysisResult
  ) {
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      const ts = new Date().toISOString();

      let line = `[${ts}] Q${num}: ${question}\n`;
      line += `  Full Answer: ${answer}\n`;

      if (analysisResult) {
        const { data } = analysisResult;

        // Handle complex extracted values
        const extractedValueStr = typeof data.extractedValue === 'object'
          ? JSON.stringify(data.extractedValue)
          : String(data.extractedValue);

        line += `  Extracted Value: ${extractedValueStr}\n`;
        line += `  Value Type: ${data.valueType}\n`;
        line += `  Extraction Success: ${analysisResult.success}\n`;

        // Log metadata if present
        if (data.metadata) {
          if (data.metadata.details) {
            line += `  Details: ${data.metadata.details}\n`;
          }
          if (data.metadata.amountOwed !== undefined && data.metadata.amountOwed !== null) {
            line += `  Amount Owed: $${data.metadata.amountOwed}\n`;
          }
          if (data.metadata.daysEstimate !== undefined && data.metadata.daysEstimate !== null) {
            line += `  Days Estimate: ${data.metadata.daysEstimate}\n`;
          }
          if (data.metadata.realtorName) {
            line += `  Realtor: ${data.metadata.realtorName}\n`;
          }
        }

        if (analysisResult.error) {
          line += `  Error: ${analysisResult.error}\n`;
        }
      }
      line += "\n";

      fs.appendFileSync(logPath, line, "utf8");
      console.log(`[DEBUG] Log written to: ${logPath}`);
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
    this.ensureDirs();

    const username = this.sanitizeUsername(params.usernameRaw);
    const statePath = this.getStatePath(username);
    const state = this.readState(statePath);
    const logPath = state.logPath ?? this.getLogPath(username);

    if (!state.logPath) {
      this.writeState(statePath, { logPath });
    }

    const qNum = params.questionNumber;
    // const questions = params.questions ?? getQuestionTexts();

    const qText =
      typeof qNum === "number" && Number.isFinite(qNum) && qNum >= 0
        ? params.questions[qNum]
        : "(unknown question)";
    this.appendLog(
      logPath,
      qNum ?? -1,
      qText,
      params.answer,
      params.analysisResult
    );
  }

  private sanitizeUsername(username: string) {
    const v = (username ?? "").trim();
    if (!v) return "anonymous";
    return v.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
  }
}
