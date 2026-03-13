import * as slackService from '../../services/slackService.js';

export function registerSlackTools() {
  return {
    tools: [
      {
        name: 'nexus_slack_send_message',
        description: 'Send a message to a Slack channel',
        inputSchema: {
          type: 'object',
          required: ['channel', 'message'],
          properties: {
            channel: { type: 'string', description: 'Channel name or ID' },
            message: { type: 'string', description: 'Message text to send' },
          },
        },
      },
      {
        name: 'nexus_slack_send_dm',
        description: 'Send a direct message to a Slack user',
        inputSchema: {
          type: 'object',
          required: ['username', 'message'],
          properties: {
            username: { type: 'string', description: 'Username or real name of recipient' },
            message: { type: 'string', description: 'Message text to send' },
          },
        },
      },
      {
        name: 'nexus_slack_get_messages',
        description: 'Get recent messages from a Slack channel',
        inputSchema: {
          type: 'object',
          required: ['channel'],
          properties: {
            channel: { type: 'string', description: 'Channel name or ID' },
            limit: { type: 'number', description: 'Number of messages (default 10)' },
          },
        },
      },
    ],
  };
}

export async function handleSlackTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case 'nexus_slack_send_message': {
      await slackService.sendMessage(args.channel as string, args.message as string);
      return { content: [{ type: 'text', text: 'Message sent successfully' }] };
    }
    case 'nexus_slack_send_dm': {
      const user = await slackService.findUserByName(args.username as string);
      if (!user) throw new Error(`User not found: ${args.username}`);
      await slackService.sendDM(user.id, args.message as string);
      return { content: [{ type: 'text', text: `DM sent to ${user.realName}` }] };
    }
    case 'nexus_slack_get_messages': {
      const messages = await slackService.getChannelMessages(
        args.channel as string,
        args.limit as number | undefined
      );
      return { content: [{ type: 'text', text: JSON.stringify(messages, null, 2) }] };
    }
    default:
      throw new Error(`Unknown slack tool: ${name}`);
  }
}
