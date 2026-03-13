# Starting NEXUS

## Every time you develop:

### Terminal 1 — Ollama (must be running first)
```
ollama serve
```

### Terminal 2 — Project
```
cd nexus
npm run dev
```

### Then open:
- App: http://localhost:5173
- Backend: http://localhost:3001
- Health check: http://localhost:3001/api/health
- Google OAuth: http://localhost:3001/api/auth/google

## First time only — after filling in .env:
Visit http://localhost:3001/api/auth/google to complete Google OAuth.
The refresh token will be saved automatically to tokens.json.
