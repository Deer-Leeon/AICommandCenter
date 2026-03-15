import dotenv from 'dotenv';
import path from 'path';
// .env lives at nexus/.env — one level above nexus/backend/
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

import express from 'express';
import cors from 'cors';
import session from 'express-session';
import { authRouter } from './routes/auth.js';
import { aiRouter } from './routes/ai.js';
import { calendarRouter } from './routes/calendar.js';
import { slackRouter } from './routes/slack.js';
import { obsidianRouter } from './routes/obsidian.js';
import { docsRouter } from './routes/docs.js';
import { healthRouter } from './routes/health.js';
import { weatherRouter } from './routes/weather.js';
import { layoutRouter } from './routes/layout.js';
import { todosRouter } from './routes/todos.js';
import { tasksRouter } from './routes/tasks.js';
import { plaidRouter } from './routes/plaid.js';
import { stocksRouter } from './routes/stocks.js';
import { quickLinksRouter } from './routes/quickLinks.js';
import { notesRouter } from './routes/notes.js';
import { wordleRouter } from './routes/wordle.js';
import { newsRouter } from './routes/news.js';
import { typingRouter } from './routes/typing.js';
import { omnibarRouter } from './routes/omnibar.js';
import { profilesRouter }     from './routes/profiles.js';
import { connectionsRouter }  from './routes/connections.js';
import { nexusStreamRouter }  from './routes/nexusStream.js';
import { sharedTodoRouter }   from './routes/sharedTodo.js';
import { chessRouter }        from './routes/chess.js';
import { pomodoroRouter }     from './routes/pomodoro.js';
import { spotifyAuthRouter }  from './routes/spotifyAuth.js';
import { spotifyRouter }      from './routes/spotify.js';
import { f1Router }           from './routes/f1.js';
import { footballRouter }     from './routes/football.js';
import { timezoneRouter }     from './routes/timezone.js';
import { currencyRouter }     from './routes/currency.js';
import { sharedPhotoRouter }  from './routes/sharedPhoto.js';

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:4173',
  'https://nexus.lj-buchmiller.com',
  process.env.FRONTEND_URL,
  process.env.PRODUCTION_URL,
].filter((o): o is string => Boolean(o));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'nexus-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: isProduction, maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);

app.use('/api/auth', authRouter);
app.use('/api/ai', aiRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/slack', slackRouter);
app.use('/api/obsidian', obsidianRouter);
app.use('/api/docs', docsRouter);
app.use('/api/health', healthRouter);
app.use('/api/weather', weatherRouter);
app.use('/api/layout', layoutRouter);
app.use('/api/todos', todosRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/plaid', plaidRouter);
app.use('/api/stocks', stocksRouter);
app.use('/api/quick-links', quickLinksRouter);
app.use('/api/notes',       notesRouter);
app.use('/api/wordle',      wordleRouter);
app.use('/api/news',        newsRouter);
app.use('/api/typing',     typingRouter);
app.use('/api/omnibar',   omnibarRouter);
app.use('/api/profiles',     profilesRouter);
app.use('/api/connections',  connectionsRouter);
app.use('/api/stream',       nexusStreamRouter);
app.use('/api/shared-todo',  sharedTodoRouter);
app.use('/api/chess',        chessRouter);
app.use('/api/pomodoro',     pomodoroRouter);
app.use('/api/auth/spotify', spotifyAuthRouter);
app.use('/api/spotify',      spotifyRouter);
app.use('/api/f1',           f1Router);
app.use('/api/football',     footballRouter);
app.use('/api/timezone',     timezoneRouter);
app.use('/api/currency',     currencyRouter);
app.use('/api/shared-photo', sharedPhotoRouter);

app.get('/', (_req, res) => {
  res.json({ name: 'NEXUS API', version: '1.0.0', status: 'running' });
});

app.listen(PORT, () => {
  const hasSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const hasSlack = !!(process.env.SLACK_BOT_TOKEN && process.env.SLACK_BOT_TOKEN !== 'xoxb-');
  const hasObsidian = !!process.env.OBSIDIAN_API_KEY;
  const hasGoogle = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

  const appUrl = process.env.PRODUCTION_URL || 'http://localhost:5173';

  console.log(`\n🚀 NEXUS Backend running on port ${PORT}`);
  console.log(`📋 Checking services...`);
  console.log(`   Ollama:    ${process.env.OLLAMA_BASE_URL || 'http://localhost:11434'}`);
  console.log(`   Supabase:  ${hasSupabase ? '✓ configured' : '✗ missing SUPABASE_URL / SERVICE_ROLE_KEY'}`);
  console.log(`   Google:    ${hasGoogle ? '✓ client credentials present' : '✗ missing GOOGLE_CLIENT_ID / SECRET'}`);
  console.log(`   Slack:     SLACK_BOT_TOKEN present → ${hasSlack}`);
  console.log(`   Obsidian:  OBSIDIAN_API_KEY present → ${hasObsidian}`);
  console.log(`\n   App:       ${appUrl}`);
  console.log(`   API:       http://localhost:${PORT}`);
  console.log(`   Health:    http://localhost:${PORT}/api/health`);
  console.log(`   OAuth:     http://localhost:${PORT}/api/auth/google  (requires Bearer token)\n`);
});

export default app;
