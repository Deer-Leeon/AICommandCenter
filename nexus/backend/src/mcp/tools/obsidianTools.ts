import * as obsidianService from '../../services/obsidianService.js';

export function registerObsidianTools() {
  return {
    tools: [
      {
        name: 'nexus_obsidian_append',
        description: 'Append content to an Obsidian note',
        inputSchema: {
          type: 'object',
          required: ['file', 'content'],
          properties: {
            file: { type: 'string', description: 'File path relative to vault root' },
            content: { type: 'string', description: 'Content to append' },
            heading: { type: 'string', description: 'Optional heading to append under' },
          },
        },
      },
      {
        name: 'nexus_obsidian_read',
        description: 'Read an Obsidian note',
        inputSchema: {
          type: 'object',
          required: ['file'],
          properties: {
            file: { type: 'string', description: 'File path relative to vault root' },
          },
        },
      },
      {
        name: 'nexus_obsidian_create',
        description: 'Create a new Obsidian note',
        inputSchema: {
          type: 'object',
          required: ['file', 'content'],
          properties: {
            file: { type: 'string', description: 'File name (without folder)' },
            content: { type: 'string', description: 'Note content in Markdown' },
            folder: { type: 'string', description: 'Optional folder path' },
          },
        },
      },
    ],
  };
}

export async function handleObsidianTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case 'nexus_obsidian_append': {
      await obsidianService.appendToFile(
        args.file as string,
        args.content as string,
        args.heading as string | undefined
      );
      return { content: [{ type: 'text', text: `Appended to ${args.file}` }] };
    }
    case 'nexus_obsidian_read': {
      const content = await obsidianService.getFile(args.file as string);
      return { content: [{ type: 'text', text: content }] };
    }
    case 'nexus_obsidian_create': {
      const folder = (args.folder as string) || (process.env.OBSIDIAN_NOTES_FOLDER || 'NEXUS Notes');
      const filePath = `${folder}/${args.file as string}`;
      await obsidianService.createNote(filePath, args.content as string);
      return { content: [{ type: 'text', text: `Created note at ${filePath}` }] };
    }
    default:
      throw new Error(`Unknown obsidian tool: ${name}`);
  }
}
