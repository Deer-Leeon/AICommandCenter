import { Router, type Request, type Response } from 'express';
import * as obsidianService from '../services/obsidianService.js';

export const obsidianRouter = Router();

obsidianRouter.get('/file', async (req: Request, res: Response) => {
  const filePath = (req.query.path as string) || (process.env.OBSIDIAN_GROCERY_FILE || 'Shopping/Groceries.md');
  try {
    const content = await obsidianService.getFile(filePath);
    res.json({ path: filePath, content });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to read file';
    res.status(500).json({ error: msg });
  }
});

obsidianRouter.post('/append', async (req: Request, res: Response) => {
  const { path: filePath, content, heading } = req.body as {
    path: string;
    content: string;
    heading?: string;
  };
  try {
    await obsidianService.appendToFile(filePath, content, heading);
    const newContent = await obsidianService.getFile(filePath);
    res.json({ ok: true, content: newContent });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to append';
    res.status(500).json({ error: msg });
  }
});

obsidianRouter.post('/create', async (req: Request, res: Response) => {
  const { path: filePath, content } = req.body as { path: string; content: string };
  try {
    await obsidianService.createNote(filePath, content);
    res.status(201).json({ ok: true, path: filePath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create note';
    res.status(500).json({ error: msg });
  }
});

obsidianRouter.get('/list', async (req: Request, res: Response) => {
  const folder = req.query.folder as string | undefined;
  try {
    const files = await obsidianService.listFiles(folder);
    res.json(files);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list files';
    res.status(500).json({ error: msg });
  }
});
