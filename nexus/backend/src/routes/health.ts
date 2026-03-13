import { Router, type Request, type Response } from 'express';
import { checkConnection as checkOllama } from '../services/ollamaService.js';
import { checkConnection as checkCalendar } from '../services/googleCalendarService.js';
import { checkConnection as checkSlack } from '../services/slackService.js';
import { checkConnection as checkObsidian } from '../services/obsidianService.js';
import { checkConnection as checkDocs } from '../services/googleDocsService.js';

export const healthRouter = Router();

healthRouter.get('/', async (_req: Request, res: Response) => {
  const [ollama, googleCalendar, slack, obsidian, googleDocs] = await Promise.allSettled([
    checkOllama(),
    checkCalendar(),
    checkSlack(),
    checkObsidian(),
    checkDocs(),
  ]);

  const result = {
    ollama: ollama.status === 'fulfilled' ? ollama.value : false,
    googleCalendar: googleCalendar.status === 'fulfilled' ? googleCalendar.value : false,
    slack: slack.status === 'fulfilled' ? slack.value : false,
    obsidian: obsidian.status === 'fulfilled' ? obsidian.value : false,
    googleDocs: googleDocs.status === 'fulfilled' ? googleDocs.value : false,
  };

  res.json(result);
});
