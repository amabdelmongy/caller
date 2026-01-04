# Caller API - Question Flow Chat with AI

A NestJS application that guides users through a predefined set of questions, logging answers and using an OpenAI-compatible API for formatting.

## Features

- 🤖 Integration with OpenAI-compatible API via LangChain
- 📋 Configurable question flow via `questions.json`
- 🔀 **Graph-based conversation flow using LangGraph**
- 📝 Per-user answer logging to timestamped files
- ✅ Intelligent answer validation and extraction
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
npm run start
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
│   ├── caller/
│   │   ├── caller.service.ts      # Linear question flow
│   │   ├── caller.flow.ts         # Conditional flow logic
│   │   ├── conversation.memory.ts # LangChain memory management
│   │   ├── analyzer.ts            # Answer extraction
│   │   └── questions.json         # Question definitions
│   ├── graph/
│   │   ├── graph.service.ts       # Graph-based conversation
│   │   └── types.ts               # Graph state types
│   └── logger/
│       └── logs.storage.ts        # State & log persistence
├── .env
├── package.json
└── README.md
```

## Technologies Used

- **NestJS** - Progressive Node.js framework
- **LangChain** - Framework for developing LLM applications
- **LangGraph** - Graph-based state machine for conversations
- **OpenAI-compatible API** - AI language model
- **TypeScript** - Type-safe JavaScript
- **Swagger** - API documentation

## Configuration

- `MODEL`: Chat model name (e.g. `gpt-4o-mini`)
- `API_KEY`: API key for your OpenAI-compatible provider
- `BASE_URL`: Base URL for the OpenAI-compatible API (optional; omit to use OpenAI default)

---

## Graph-Based Conversation Flow (GraphService)

The `GraphService` uses **LangGraph** to manage a state-machine-driven conversation. Each node represents a question, and edges define transitions based on user responses.

### Key Features

- **Structured State Management**: All conversation data is stored in a typed `GraphState` object
- **Answer Validation**: Each node validates and extracts structured data from user responses
- **Clarification Handling**: If a response is unclear, the system asks for clarification without advancing
- **Conditional Branching**: Conversation path changes based on user answers (e.g., skip tenant questions if owner-occupied)
- **Persistent Logging**: Both raw answers and extracted values are logged

### Graph State Structure

```typescript
interface GraphState {
  username: string;
  currentNode: ConversationNode;
  messages: Array<{ role: "ai" | "human"; content: string }>;
  answers: Record<string, string>;           // Raw user answers
  extractedAnswers: Record<string, any>;     // Structured extracted values
  interestedInSelling: boolean | null;
  hasOtherProperty: boolean | null;
  isTenantOccupied: boolean | null;
  isAnnualLease: boolean | null;
  email: string | null;
  isComplete: boolean;
  lastQuestion: string;
  lastResponse: string;
}
```

### Node Types and Questions

| Node | Question |
|------|----------|
| `initial_interest` | Have you ever considered selling? |
| `other_property` | Do you have any other property to sell? |
| `price_range` | Do you have a price range in mind? |
| `bedrooms_bathrooms` | How many bedrooms and bathrooms? |
| `kitchen_updates` | Any kitchen/bathroom updates in past 5 years? |
| `property_condition` | Rate condition 1-10? |
| `occupancy` | Occupied by you or tenants? |
| `lease_type` | Monthly or annual lease? |
| `lease_expiry` | When does lease expire? |
| `selling_reason` | Main reason for selling? |
| `collect_email` | What's your email address? |
| `closing` | Thank you message |

### Validation Types

Each node validates responses and extracts structured data:

| Type | Extracted Format | Example Input → Output |
|------|------------------|------------------------|
| `yes/no` | `"yes"` or `"no"` | "Yeah sure" → `"yes"` |
| `price_range` | `{min, max, currency}` | "$200k-$300k" → `{min: 200000, max: 300000}` |
| `bedrooms_bathrooms` | `{bedrooms, bathrooms}` | "3 bed 2 bath" → `{bedrooms: 3, bathrooms: 2}` |
| `scale` | `1-10` | "Pretty good" → `7` |
| `occupancy` | `"owner"` or `"tenant"` | "I live here" → `"owner"` |
| `lease_type` | `"monthly"` or `"annual"` | "Year lease" → `"annual"` |
| `email` | `string` | "test@example.com" → `"test@example.com"` |

### Graph Flow Chart

```
                              ┌─────────────────┐
                              │     START       │
                              └────────┬────────┘
                                       │
                                       ▼
                    ┌──────────────────────────────────────┐
                    │      initial_interest                │
                    │  "Have you considered selling?"      │
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
                      │              ┌──────────────────────────────────┐
                      │              │        other_property            │
                      │              │  "Any other property to sell?"   │
                      │              └──────────────────┬───────────────┘
                      │                                 │
                      │                    ┌────────────┴────────────┐
                      │                    │                         │
                      │                    ▼                         ▼
                      │               ┌────────┐                ┌────────┐
                      │               │  YES   │                │   NO   │
                      │               └────┬───┘                └────┬───┘
                      │                    │                         │
                      └──────────┬─────────┘                         │
                                 │                                   │
                                 ▼                                   │
               ┌─────────────────────────────────┐                   │
               │         price_range             │                   │
               │  "Do you have a price range?"   │                   │
               └──────────────┬──────────────────┘                   │
                              │                                      │
                              ▼                                      │
               ┌─────────────────────────────────┐                   │
               │      bedrooms_bathrooms         │                   │
               │  "How many beds/baths?"         │                   │
               └──────────────┬──────────────────┘                   │
                              │                                      │
                              ▼                                      │
               ┌─────────────────────────────────┐                   │
               │       kitchen_updates           │                   │
               │  "Any updates in past 5 years?" │                   │
               └──────────────┬──────────────────┘                   │
                              │                                      │
                              ▼                                      │
               ┌─────────────────────────────────┐                   │
               │      property_condition         │                   │
               │  "Rate condition 1-10?"         │                   │
               └──────────────┬──────────────────┘                   │
                              │                                      │
                              ▼                                      │
               ┌─────────────────────────────────┐                   │
               │          occupancy              │                   │
               │  "Occupied by you or tenants?"  │                   │
               └──────────────┬──────────────────┘                   │
                              │                                      │
                 ┌────────────┴────────────┐                         │
                 │                         │                         │
                 ▼                         ▼                         │
          ┌───────────┐             ┌─────────────┐                  │
          │  TENANT   │             │   OWNER     │                  │
          └─────┬─────┘             └──────┬──────┘                  │
                │                          │                         │
                ▼                          │                         │
   ┌────────────────────────┐              │                         │
   │      lease_type        │              │                         │
   │  "Monthly or annual?"  │              │                         │
   └───────────┬────────────┘              │                         │
               │                           │                         │
      ┌────────┴────────┐                  │                         │
      │                 │                  │                         │
      ▼                 ▼                  │                         │
 ┌─────────┐       ┌─────────┐             │                         │
 │ MONTHLY │       │ ANNUAL  │             │                         │
 └────┬────┘       └────┬────┘             │                         │
      │                 │                  │                         │
      │                 ▼                  │                         │
      │    ┌────────────────────────┐      │                         │
      │    │     lease_expiry       │      │                         │
      │    │  "When does it expire?"│      │                         │
      │    └───────────┬────────────┘      │                         │
      │                │                   │                         │
      └───────┬────────┴───────────────────┘                         │
              │                                                      │
              ▼                                                      │
┌─────────────────────────────────┐                                  │
│        selling_reason           │                                  │
│  "Main reason for selling?"     │                                  │
└──────────────┬──────────────────┘                                  │
               │                                                     │
               ▼                                                     │
┌─────────────────────────────────┐                                  │
│        collect_email            │                                  │
│  "What's your email address?"   │                                  │
└──────────────┬──────────────────┘                                  │
               │                                                     │
               ▼                                                     │
┌─────────────────────────────────┐                                  │
│          closing                │◄─────────────────────────────────┘
│  "Thank you for your time..."   │
└──────────────┬──────────────────┘
               │
               ▼
         ┌───────────┐
         │    END    │
         └───────────┘
```

### Clarification Flow

When a user's response is unclear, the system re-asks the same question:

```
┌─────────────────────────────┐
│       Current Node          │
│   (e.g., price_range)       │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│    Validate Response        │
└──────────────┬──────────────┘
               │
      ┌────────┴────────┐
      │                 │
      ▼                 ▼
 ┌─────────┐       ┌─────────┐
 │  VALID  │       │ UNCLEAR │
 └────┬────┘       └────┬────┘
      │                 │
      │                 ▼
      │    ┌────────────────────────┐
      │    │  Ask Clarification     │
      │    │  (Stay on same node)   │
      │    └───────────┬────────────┘
      │                │
      │                └──────► (User responds again)
      │
      ▼
┌─────────────────────────────┐
│    Move to Next Node        │
└─────────────────────────────┘
```

### Example Conversation Log

```
[2024-01-15T10:30:00.000Z] Node: initial_interest
  Question: Have you ever considered or had any intention of selling before?
  User Response: Yeah, I've been thinking about it
  Extracted Value: "yes"
  Next Node: price_range
  AI Response: Great! May I ask you a few questions about the condition? Do you have a price range in mind?
----------------------------------------
[2024-01-15T10:30:30.000Z] Node: price_range
  Question: Do you have a price range in mind?
  User Response: Around 250k to 300k
  Extracted Value: {"raw":"Around 250k to 300k","min":250000,"max":300000,"currency":"USD"}
  Next Node: bedrooms_bathrooms
  AI Response: Perfect. How many bedrooms and bathrooms does the property have?
----------------------------------------
```

---

## Linear Flow (CallerService)

The original `CallerService` runs a scripted calling conversation driven by `questions.json`, with persisted state per `username`.

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

### Linear Flow Chart

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

---

## Telegram Bot Usage

This project can run a Telegram bot **inside the same NestJS process** (no HTTP proxy). The bot forwards Telegram messages to `CallerService` directly.

### 1) Create a Telegram bot
1. Open Telegram and chat with **@BotFather**
2. Run `/newbot`
3. Copy the token and set it as `TELEGRAM_BOT_TOKEN`

### 2) Configure environment variables

In `.env` (example keys):
```
TELEGRAM_BOT_TOKEN=your_bot_token
START_TELEGRAM_BOT=true
```

### 3) Start the application
```bash
npm run start
```

### 4) Find your chat or channel ID
1. Add the bot to a group or channel
2. Use a tool like [getidsbot](https://t.me/getidsbot) to retrieve the chat ID

### 5) Supported commands
- `/start` - Start a new conversation
- `/reset` - Reset the current conversation (**type `/reset` in the Telegram chat with the bot to clear your session and start over**)

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
