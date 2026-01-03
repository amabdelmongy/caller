# Caller API - Question Flow Chat with AI

A NestJS application that guides users through a predefined set of questions, logging answers and using an OpenAI-compatible API for formatting.

## Features

- 🤖 Integration with OpenAI-compatible API via LangChain
- 📋 Configurable question flow via `questions.json`
- 📝 Per-user answer logging to timestamped files
- 🔢 0-based question indexing from client
- ⚡ Powered by NestJS framework
- 📖 Swagger API documentation

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- OpenAI-compatible API key

## Setup

1. **Clone the repository** (if applicable):
```bash
git clone <repository-url>
cd Call-api
```

2. **Install dependencies**:
```bash
npm install

# Install validation packages (required for NestJS)
npm install class-validator class-transformer

# Install Swagger for API documentation (NestJS v10 compatible)
npm install @nestjs/swagger@^7 swagger-ui-express
```

3. **Configure environment variables**:

Create a `.env` file in the root directory:
```bash
MODEL=gpt-4o-mini
API_KEY=your_actual_api_key
BASE_URL=https://api.openai.com/v1/ (optional; omit to use OpenAI default)
PORT=3000
```

4. **Run the application**:
```bash
# Development mode
npm run start:dev

# Production mode
npm run start:prod
```

## Usage

Once the application starts:
1. The client sends a 0-based index to select a question
2. The server logs answers to timestamped files
3. The OpenAI-compatible API formats the responses
4. **Access API documentation** at `http://localhost:3000/swagger` (if Swagger is configured)

### Example Interaction

```
Client: 0
Server: What is your name?
Client: John Doe
Server: Answer logged and formatted.
```

## Project Structure

```
Call-api/
├── src/
│   ├── app.module.ts
│   ├── main.ts
│   ├── questions.json
│   └── ...
├── .env
├── package.json
└── README.md
```

## Technologies Used

- **NestJS** - Progressive Node.js framework
- **LangChain** - Framework for developing LLM applications
- **OpenAI-compatible API** - AI language model
- **TypeScript** - Type-safe JavaScript
- **Swagger** - API documentation

## Configuration

- `MODEL`: Chat model name (e.g. `gpt-4o-mini`)
- `API_KEY`: API key for your OpenAI-compatible provider
- `BASE_URL`: Base URL for the OpenAI-compatible API (optional; omit to use OpenAI default)

## Flow

This service runs a scripted calling conversation driven by `questions.json`, with persisted state per `username`.

### High-level lifecycle

1. **Start (`startConversation(username)`)**
   - Sanitizes `username`.
   - Clears any existing memory + stored conversation state.
   - Loads `questions.json`.
   - Sends: `intro.greeting` + the first question (`questions[0]`).
   - Initializes state:
     - `currentQuestionIndex = 0`
     - `answers = {}`
     - `skipQuestions = []`
     - `interestedInSelling = null`
   - Persists state + appends a log entry.

2. **Chat loop (`chat(username, message)`)**
   - Ensures a conversation exists (otherwise starts one).
   - Loads saved state into memory if needed.
   - Adds the user message to memory.

   **A) Rebuttal path (user asks a question)**
   - If `isUserAskingQuestion(message)` is true:
     - Attempts `handleRebuttal(message)` (keyword → `script.rebuttals[key]`)
     - If matched:
       - Responds with the rebuttal text
       - Logs + persists
       - Returns early (does not advance to next scripted question)

   **B) Answer analysis + conditional flow**
   - Analyzes the user answer against the current question via `analyzeAnswer(...)`.
   - Stores the raw answer in `answers["q{currentIdx}"]`.
   - Runs conditional branching via `evaluateConditionalFlow(...)`:
     - may set `interestedInSelling`
     - may add indices to `skipQuestions`
     - may override `currentQuestionIndex`
     - may return an immediate `response`
   - If a conditional `response` is returned:
     - Responds with it, logs + persists, returns early.

   **C) Move to next question (default)**
   - Computes `nextIdx = currentQuestionIndex + 1`, skipping any indices in `skipQuestions`.
   - If `nextIdx >= questions.length`:
     - Responds with `closing.thankYou` and ends.
   - Else:
     - Formats the next question using LLM context (`formatQuestion(...)`) and returns it.

### Pseudocode

```text
startConversation(user):
  clear memory/state
  send greeting + questions[0]
  set currentQuestionIndex=0
  persist

chat(user, msg):
  if no conversation: return startConversation(user)
  restore state if needed
  addUserMessage(msg)

  if isUserAskingQuestion(msg):
    rebuttal = handleRebuttal(msg)
    if rebuttal: respond(rebuttal); persist; return

  analyzeAnswer(currentQuestion, msg)
  save answers[q{idx}] = msg

  conditional = evaluateConditionalFlow(...)
  apply conditional updates (skipQuestions, interestedInSelling, nextQuestionIndex)
  if conditional.response: respond(conditional.response); persist; return

  nextIdx = computeNextSkippingSkips()
  if nextIdx >= total: respond(closing.thankYou); return
  respond(formatQuestion(questions[nextIdx]))
```

### Flowchart

```
                              ┌─────────────────┐
                              │     START       │
                              └────────┬────────┘
                                       │
                                       ▼
                    ┌──────────────────────────────────────┐
                    │ Q0: Have you ever considered selling?│
                    └──────────────────┬───────────────────┘
                                       │
                      ┌────────────────┴────────────────┐
                      │                                 │
                      ▼                                 ▼
                 ┌────────┐                        ┌────────┐
                 │  YES   │                        │   NO   │
                 └────┬───┘                        └────┬───┘
                      │                                 │
                      │                                 ▼
                      │              ┌─────────────────────────────────────┐
                      │              │ Q1: Consider selling in near future?│
                      │              └──────────────────┬──────────────────┘
                      │                                 │
                      │                    ┌────────────┴────────────┐
                      │                    │                         │
                      │                    ▼                         ▼
                      │               ┌────────┐                ┌────────┐
                      │               │  YES   │                │   NO   │
                      │               └────┬───┘                └────┬───┘
                      │                    │                         │
                      │                    │                         ▼
                      │                    │    ┌────────────────────────────────┐
                      │                    │    │ Q2: Any other property to sell?│
                      │                    │    └──────────────┬─────────────────┘
                      │                    │                   │
                      │                    └─────────┬─────────┘
                      │                              │
                      │  ┌───────────────────────────┘
                      │  │ (Skip Q1, Q2)
                      ▼  ▼
               ┌─────────────────────────────┐
               │ Q3: Do you have a price range?│
               └──────────────┬──────────────┘
                              │
                              ▼
               ┌─────────────────────────────┐
               │ Q4: Is this price negotiable?│
               └──────────────┬──────────────┘
                              │
                     ┌────────┴────────┐
                     │                 │
                     ▼                 ▼
                ┌────────┐        ┌────────┐
                │  YES   │        │   NO   │
                └────┬───┘        └────┬───┘
                     │                 │
                     ▼                 │
     ┌───────────────────────────────┐ │
     │ Q5: What's your bottom line?  │ │
     └───────────────┬───────────────┘ │
                     │                 │
                     └────────┬────────┘
                              │
                              ▼
               ┌─────────────────────────────┐
               │ Q6-Q14: Condition Questions │
               │ (Roof, HVAC, Kitchen, etc.) │
               └──────────────┬──────────────┘
                              │
                              ▼
          ┌────────────────────────────────────────┐
          │ Q15: Is property occupied by tenants?  │
          └────────────────────┬───────────────────┘
                               │
                  ┌────────────┴────────────┐
                  │                         │
                  ▼                         ▼
           ┌───────────┐             ┌─────────────┐
           │  TENANTS  │             │ OWNER (Me)  │
           └─────┬─────┘             └──────┬──────┘
                 │                          │
                 ▼                          │
    ┌─────────────────────────────┐         │
    │ Q16: Monthly or Annual lease?│         │
    └──────────────┬──────────────┘         │
                   │                        │
          ┌────────┴────────┐               │
          │                 │               │
          ▼                 ▼               │
     ┌─────────┐       ┌─────────┐          │
     │ MONTHLY │       │ ANNUAL  │          │
     └────┬────┘       └────┬────┘          │
          │                 │               │
          │                 ▼               │
          │    ┌────────────────────────┐   │
          │    │ Q17: When does it expire?│  │
          │    └───────────┬────────────┘   │
          │                │               │
          └───────┬────────┘               │
                  │    (Skip Q16, Q17)     │
                  └───────────┬────────────┘
                              │
                              ▼
               ┌─────────────────────────────┐
               │ Q18: Reason for selling?    │
               └──────────────┬──────────────┘
                              │
                              ▼
               ┌─────────────────────────────┐
               │ Q19-Q24: Closing Questions  │
               │ (Timeline, Contact, Email,  │
               │  Referrals)                 │
               └──────────────┬──────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   THANK YOU     │
                    │     (END)       │
                    └─────────────────┘
```

## Telegram Bot (Node.js / TypeScript)

Direct mode only: the bot loads Nest `AppModule` and calls `CallerService` in-process (no HTTP).

### Env
- `TELEGRAM_BOT_TOKEN`

### Run
```
npm run bot:dev
```

## Notes

This service uses an OpenAI-compatible Chat Completions endpoint via LangChain (`@langchain/openai`).

## Troubleshooting

### API Key Issues
- Ensure your API key is valid and properly set in `.env`
- Check that the `.env` file is in the root directory

### Connection Errors
- Verify your internet connection
- Check if the OpenAI-compatible API service is operational

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[Specify your license here]

## Contact

[Your contact information]
