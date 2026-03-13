import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { registerCalendarTools, handleCalendarTool } from './tools/calendarTools.js';
import { registerSlackTools, handleSlackTool } from './tools/slackTools.js';
import { registerObsidianTools, handleObsidianTool } from './tools/obsidianTools.js';
import { registerDocsTools, handleDocsTool } from './tools/docsTools.js';

const server = new Server(
  { name: 'nexus-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

const calendarTools = registerCalendarTools(server);
const slackTools = registerSlackTools();
const obsidianTools = registerObsidianTools();
const docsTools = registerDocsTools();

const allTools = [
  ...calendarTools.tools,
  ...slackTools.tools,
  ...obsidianTools.tools,
  ...docsTools.tools,
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: allTools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    if (name.startsWith('nexus_calendar_')) {
      return await handleCalendarTool(name, args as Record<string, unknown>);
    } else if (name.startsWith('nexus_slack_')) {
      return await handleSlackTool(name, args as Record<string, unknown>);
    } else if (name.startsWith('nexus_obsidian_')) {
      return await handleObsidianTool(name, args as Record<string, unknown>);
    } else if (name.startsWith('nexus_docs_')) {
      return await handleDocsTool(name, args as Record<string, unknown>);
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Tool execution failed';
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('NEXUS MCP Server running on stdio');
  console.error('Available tools:', allTools.map((t) => t.name).join(', '));
}

main().catch((err) => {
  console.error('Fatal error in NEXUS MCP Server:', err);
  process.exit(1);
});
