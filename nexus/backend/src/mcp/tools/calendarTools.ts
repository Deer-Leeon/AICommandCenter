import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as calendarService from '../../services/googleCalendarService.js';

export function registerCalendarTools(server: Server) {
  const tools = [
    {
      name: 'nexus_calendar_list_events',
      description: 'List upcoming calendar events',
      inputSchema: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Number of days to look ahead (default 7)' },
        },
      },
    },
    {
      name: 'nexus_calendar_create_event',
      description: 'Create a new Google Calendar event',
      inputSchema: {
        type: 'object',
        required: ['title', 'date', 'time'],
        properties: {
          title: { type: 'string', description: 'Event title' },
          date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
          time: { type: 'string', description: 'Time in HH:MM 24h format' },
          duration: { type: 'number', description: 'Duration in minutes (default 60)' },
          description: { type: 'string', description: 'Optional event description' },
        },
      },
    },
    {
      name: 'nexus_calendar_delete_event',
      description: 'Delete a Google Calendar event by ID',
      inputSchema: {
        type: 'object',
        required: ['eventId'],
        properties: {
          eventId: { type: 'string', description: 'Google Calendar event ID' },
        },
      },
    },
  ];

  return { tools };
}

export async function handleCalendarTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case 'nexus_calendar_list_events': {
      const events = await calendarService.listEvents((args.days as number || 7) * 3);
      return { content: [{ type: 'text', text: JSON.stringify(events, null, 2) }] };
    }
    case 'nexus_calendar_create_event': {
      const event = await calendarService.createEvent({
        title: args.title as string,
        date: args.date as string,
        time: args.time as string,
        duration: args.duration as number | undefined,
        description: args.description as string | undefined,
      });
      return { content: [{ type: 'text', text: JSON.stringify(event, null, 2) }] };
    }
    case 'nexus_calendar_delete_event': {
      await calendarService.deleteEvent(args.eventId as string);
      return { content: [{ type: 'text', text: `Event ${args.eventId} deleted successfully` }] };
    }
    default:
      throw new Error(`Unknown calendar tool: ${name}`);
  }
}
