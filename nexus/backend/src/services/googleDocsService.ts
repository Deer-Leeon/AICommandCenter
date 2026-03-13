import { google } from 'googleapis';
import { getAuthenticatedClient, loadTokens } from './googleAuthService.js';

export interface DocFile {
  id: string;
  name: string;
  modifiedTime: string;
  url: string;
}

export async function listDocuments(maxResults = 10): Promise<DocFile[]> {
  const auth = await getAuthenticatedClient();
  const drive = google.drive({ version: 'v3', auth });

  const response = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.document'",
    pageSize: maxResults,
    fields: 'files(id, name, modifiedTime, webViewLink)',
    orderBy: 'modifiedTime desc',
  });

  const files = response.data.files || [];
  return files.map((f) => ({
    id: f.id || '',
    name: f.name || 'Untitled',
    modifiedTime: f.modifiedTime || new Date().toISOString(),
    url: f.webViewLink || `https://docs.google.com/document/d/${f.id}/edit`,
  }));
}

export async function getDocument(docId: string): Promise<string> {
  const auth = await getAuthenticatedClient();
  const docs = google.docs({ version: 'v1', auth });

  const response = await docs.documents.get({ documentId: docId });
  const content = response.data.body?.content || [];

  return content
    .flatMap((block) =>
      (block.paragraph?.elements || []).map((el) => el.textRun?.content || '')
    )
    .join('');
}

export async function appendToDocument(docId: string, text: string): Promise<void> {
  const auth = await getAuthenticatedClient();
  const docs = google.docs({ version: 'v1', auth });

  // Get current end index
  const docRes = await docs.documents.get({ documentId: docId });
  const content = docRes.data.body?.content || [];
  const lastBlock = content[content.length - 1];
  const endIndex = lastBlock?.endIndex ? lastBlock.endIndex - 1 : 1;

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        {
          insertText: {
            location: { index: endIndex },
            text: `\n${text}`,
          },
        },
      ],
    },
  });
}

export async function checkConnection(): Promise<boolean> {
  try {
    const tokens = loadTokens();
    if (!tokens?.refresh_token) return false;
    await listDocuments(1);
    return true;
  } catch {
    return false;
  }
}
