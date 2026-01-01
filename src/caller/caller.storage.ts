import * as fs from 'node:fs';
import * as path from 'node:path';

export type UserState = {
  logPath?: string;
};

export class CallerStorage {
  private readonly logsDir: string;
  private readonly stateDir: string;

  constructor(private readonly baseDir: string) {
    this.logsDir = path.join(this.baseDir, 'logs');
    this.stateDir = path.join(this.baseDir, 'state');
  }

  ensureDirs() {
    if (!fs.existsSync(this.logsDir)) fs.mkdirSync(this.logsDir, { recursive: true });
    if (!fs.existsSync(this.stateDir)) fs.mkdirSync(this.stateDir, { recursive: true });
  }

  getStatePath(username: string) {
    return path.join(this.stateDir, `${username}.json`);
  }

  getLogPath(username: string) {
    const ts = new Date().toISOString().replace(/:/g, '-');
    return path.join(this.logsDir, `${username}.${ts}.log`);
  }

  readState(statePath: string): UserState {
    if (!fs.existsSync(statePath)) return {};
    try {
      const raw = fs.readFileSync(statePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<UserState>;
      return { logPath: typeof parsed.logPath === 'string' ? parsed.logPath : undefined };
    } catch {
      return {};
    }
  }

  writeState(statePath: string, state: UserState) {
    fs.writeFileSync(statePath, JSON.stringify(state), 'utf8');
  }

  appendLog(logPath: string, num: number, question: string, answer: string) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const ts = new Date().toISOString();
    const line = `[${ts}] Q: ${num}) ${question} | A: ${answer}\n`;
    fs.appendFileSync(logPath, line, 'utf8');
  }

  logAnswer(params: {
    usernameRaw: string;
    questions: string[];
    answer: string;
    questionNumber?: number;
  }): { logPath: string; username: string; statePath: string } {
    this.ensureDirs();

    const username = this.sanitizeUsername(params.usernameRaw);
    const statePath = this.getStatePath(username);
    const state = this.readState(statePath);
    const logPath = state.logPath ?? this.getLogPath(username);

    if (!state.logPath) {
      this.writeState(statePath, { logPath });
    }

    const qNum = params.questionNumber;
    if (typeof qNum === 'number' && Number.isFinite(qNum) && qNum >= 0) {
      const qText = params.questions[qNum] ?? '(unknown question)';
      this.appendLog(logPath, qNum, qText, params.answer);
    }

    return { logPath, username, statePath };
  }

  private sanitizeUsername(username: string) {
    const v = (username ?? '').trim();
    if (!v) return 'anonymous';
    return v.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
  }
}
