import * as fs from "node:fs";
import * as path from "node:path";
import { AnalysisResult } from "./types";
// import { getQuestionTexts } from "./questions.config";

export type UserState = {
  logPath?: string;
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
      };
    } catch {
      return {};
    }
  }

  writeState(statePath: string, state: UserState) {
    fs.writeFileSync(statePath, JSON.stringify(state), "utf8");
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
        line += `  Extracted Value: ${analysisResult.data.extractedValue}\n`;
        line += `  Value Type: ${analysisResult.data.valueType}\n`;
        line += `  Extraction Success: ${analysisResult.success}\n`;
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
