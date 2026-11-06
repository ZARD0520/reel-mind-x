import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CanvasToolsService, toolDescriptions, toolSchemas, type CanvasToolName, type CanvasToolScope } from './canvas-tools.service';

@Injectable()
export class CanvasMcpService {
  constructor(private readonly tools: CanvasToolsService) {}

  createServer(scope: CanvasToolScope) {
    const server = new McpServer({ name: 'reel-canvas', version: '1.0.0' });
    for (const name of Object.keys(toolSchemas) as CanvasToolName[]) {
      server.registerTool(name, {
        description: toolDescriptions[name], inputSchema: toolSchemas[name].shape,
        annotations: { readOnlyHint: name === 'get_canvas_context', destructiveHint: name === 'update_node_prompt', openWorldHint: false },
      }, async (args: Record<string, unknown>) => {
        try {
          const result = await this.tools.execute(scope, name, args);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
        } catch (error) {
          return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : '工具执行失败' }] };
        }
      });
    }
    return server;
  }

  async connect(scope: CanvasToolScope) {
    const server = this.createServer(scope);
    const client = new Client({ name: 'reel-creative-agent', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    try {
      await client.connect(clientTransport);
      return { client, close: async () => { await client.close(); await server.close(); } };
    } catch (error) { await server.close(); throw error; }
  }
}
