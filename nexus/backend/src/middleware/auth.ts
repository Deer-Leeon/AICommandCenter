import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase.js';

export interface AuthRequest extends Request {
  user?: { id: string; email: string };
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ error: 'Unauthorized', success: false });
    return;
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: 'Invalid token', success: false });
    return;
  }

  req.user = { id: user.id, email: user.email! };
  next();
}

// ─── Legacy env-based guards (kept for Slack/Obsidian routes) ───────────────
export function requireSlackAuth(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token || token === 'xoxb-') {
    res.status(401).json({ error: 'Slack not configured. Add SLACK_BOT_TOKEN to .env.' });
    return;
  }
  next();
}
