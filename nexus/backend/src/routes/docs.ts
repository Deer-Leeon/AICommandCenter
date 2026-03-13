import { Router, type Response } from 'express';
import { google } from 'googleapis';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { getTokensForService, getGoogleAuthClient } from '../services/tokenService.js';

export const docsRouter = Router();

docsRouter.get('/list', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const tokens = await getTokensForService(req.user!.id, 'google-drive');
    if (!tokens) {
      res.json({ docs: [], needsAuth: true });
      return;
    }

    const auth = getGoogleAuthClient(tokens);
    const drive = google.drive({ version: 'v3', auth });

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

    const response = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.document' and trashed=false",
      fields: 'files(id, name, modifiedTime, webViewLink)',
      orderBy: 'modifiedTime desc',
      pageSize: limit,
    });

    const docs = (response.data.files ?? []).map((f) => ({
      id: f.id ?? '',
      name: f.name ?? '(Untitled)',
      modifiedTime: f.modifiedTime ?? '',
      url: f.webViewLink ?? '',
    }));

    res.json(docs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list documents';
    console.error('Docs GET /list:', msg);
    res.status(500).json({ error: msg, success: false });
  }
});

docsRouter.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const tokens = await getTokensForService(req.user!.id, 'google-docs');
    if (!tokens) {
      res.status(401).json({ error: 'Google not connected', needsAuth: true });
      return;
    }

    const auth = getGoogleAuthClient(tokens);
    const docs = google.docs({ version: 'v1', auth });

    const response = await docs.documents.get({ documentId: req.params.id });

    // Extract plain text from the document body
    const content = (response.data.body?.content ?? [])
      .flatMap((el) => el.paragraph?.elements ?? [])
      .map((el) => el.textRun?.content ?? '')
      .join('');

    res.json({ id: req.params.id, content });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to get document';
    res.status(500).json({ error: msg, success: false });
  }
});

docsRouter.post('/:id/append', requireAuth, async (req: AuthRequest, res: Response) => {
  const { text } = req.body as { text: string };
  try {
    const tokens = await getTokensForService(req.user!.id, 'google-docs');
    if (!tokens) {
      res.status(401).json({ error: 'Google not connected', needsAuth: true });
      return;
    }

    const auth = getGoogleAuthClient(tokens);
    const docs = google.docs({ version: 'v1', auth });

    // Get current end-of-document index
    const doc = await docs.documents.get({ documentId: req.params.id });
    const endIndex = doc.data.body?.content?.at(-1)?.endIndex ?? 1;

    await docs.documents.batchUpdate({
      documentId: req.params.id,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: endIndex - 1 },
              text: `\n${text}`,
            },
          },
        ],
      },
    });

    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to append to document';
    res.status(500).json({ error: msg, success: false });
  }
});
