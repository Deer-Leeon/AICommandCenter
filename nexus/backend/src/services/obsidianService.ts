/**
 * Obsidian Integration Setup:
 * 1. In Obsidian, go to Settings → Community Plugins → Browse
 * 2. Search for "Local REST API" → Install → Enable
 * 3. In the plugin settings, set an API key and note the port (default 27123)
 * 4. Copy the API key to OBSIDIAN_API_KEY in .env
 * 5. Make sure Obsidian is running when using NEXUS
 */

function getApiUrl(): string {
  return process.env.OBSIDIAN_API_URL || 'http://localhost:27123';
}

function getApiKey(): string {
  return process.env.OBSIDIAN_API_KEY || '';
}

function getHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    'Content-Type': 'text/markdown',
  };
}

export async function getFile(filePath: string): Promise<string> {
  const res = await fetch(`${getApiUrl()}/vault/${encodeURIComponent(filePath)}`, {
    headers: getHeaders(),
  });
  if (!res.ok) {
    if (res.status === 404) return '';
    throw new Error(`Obsidian API error: ${res.status}`);
  }
  return res.text();
}

export async function appendToFile(
  filePath: string,
  content: string,
  heading?: string
): Promise<void> {
  let existing = '';
  try {
    existing = await getFile(filePath);
  } catch {
    // File might not exist yet
  }

  let newContent = existing;
  if (heading) {
    const headingRegex = new RegExp(`^#{1,6}\\s+${heading}`, 'm');
    if (headingRegex.test(existing)) {
      // Insert under the heading
      newContent = existing.replace(headingRegex, (match) => `${match}\n${content}`);
    } else {
      newContent = `${existing}\n## ${heading}\n${content}\n`;
    }
  } else {
    newContent = existing ? `${existing}\n${content}` : content;
  }

  await writeFile(filePath, newContent);
}

async function writeFile(filePath: string, content: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/vault/${encodeURIComponent(filePath)}`, {
    method: 'PUT',
    headers: getHeaders(),
    body: content,
  });
  if (!res.ok) {
    throw new Error(`Obsidian write error: ${res.status}`);
  }
}

export async function createNote(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content);
}

export async function listFiles(folder = ''): Promise<string[]> {
  const url = folder
    ? `${getApiUrl()}/vault/${encodeURIComponent(folder)}/`
    : `${getApiUrl()}/vault/`;

  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) return [];

  const data = (await res.json()) as { files: string[] };
  return data.files || [];
}

export async function checkConnection(): Promise<boolean> {
  if (!getApiKey()) return false;
  try {
    const res = await fetch(`${getApiUrl()}/vault/`, {
      headers: getHeaders(),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { files?: unknown };
    return Array.isArray(data.files);
  } catch {
    return false;
  }
}
