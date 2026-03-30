<<<<<<< HEAD
# AIHackathon
AI QA Intelligence agent
=======
# qa-ai-agent

Express + TypeScript API using `dotenv`, `cors`, and OpenAI.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `OPENAI_API_KEY` in `.env`.
3. Install deps (if needed): `npm install`

## Run

Dev:

```bash
npm run dev
```

Build + start:

```bash
npm run build
npm run start
```

## Endpoints

`GET /health` -> `{ "ok": true }`

`POST /api/chat`

Request body:

```json
{ "message": "Hello!" }
```

Response:

```json
{ "reply": "..." }
```

>>>>>>> 939d81e (Initial commit)
