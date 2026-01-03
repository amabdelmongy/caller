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
