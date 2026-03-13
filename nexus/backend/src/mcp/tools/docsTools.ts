import * as docsService from '../../services/googleDocsService.js';

export function registerDocsTools() {
  return {
    tools: [
      {
        name: 'nexus_docs_list',
        description: 'List recent Google Docs documents',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Number of documents to return (default 10)' },
          },
        },
      },
      {
        name: 'nexus_docs_append',
        description: 'Append text to a Google Doc',
        inputSchema: {
          type: 'object',
          required: ['docId', 'text'],
          properties: {
            docId: { type: 'string', description: 'Google Doc document ID' },
            text: { type: 'string', description: 'Text to append' },
          },
        },
      },
    ],
  };
}

export async function handleDocsTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case 'nexus_docs_list': {
      const docs = await docsService.listDocuments(args.limit as number | undefined);
      return { content: [{ type: 'text', text: JSON.stringify(docs, null, 2) }] };
    }
    case 'nexus_docs_append': {
      await docsService.appendToDocument(args.docId as string, args.text as string);
      return { content: [{ type: 'text', text: `Text appended to document ${args.docId}` }] };
    }
    default:
      throw new Error(`Unknown docs tool: ${name}`);
  }
}
