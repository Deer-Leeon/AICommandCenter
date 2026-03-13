import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Absolute path anchored to this file's location — works regardless of cwd
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOKENS_FILE = path.join(__dirname, '../../tokens.json');
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive.readonly',
];

export function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/auth/google/callback'
  );
}

export function getAuthUrl(): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

export async function exchangeCodeForTokens(code: string): Promise<string> {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);

  if (tokens.refresh_token) {
    // Persist refresh token
    saveTokens({ refresh_token: tokens.refresh_token, access_token: tokens.access_token || '' });
  }

  return tokens.refresh_token || loadTokens()?.refresh_token || '';
}

export function saveTokens(tokens: { refresh_token: string; access_token: string }) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

export function loadTokens(): { refresh_token: string; access_token: string } | null {
  // Check env first, then file
  const envToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();
  if (envToken && envToken.length > 10) {
    return { refresh_token: envToken, access_token: '' };
  }
  if (fs.existsSync(TOKENS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8')) as {
        refresh_token: string;
        access_token: string;
      };
    } catch {
      return null;
    }
  }
  return null;
}

export async function getAuthenticatedClient() {
  const tokens = loadTokens();
  if (!tokens?.refresh_token) {
    throw new Error('Google not authenticated. Visit /api/auth/google to connect.');
  }
  const client = createOAuthClient();
  client.setCredentials({ refresh_token: tokens.refresh_token });
  return client;
}
