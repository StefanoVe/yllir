import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { ToolContext, CockpitTool } from "./tools.js";

export class TurnTokens {
  private contexts = new Map<string, ToolContext>();
  issue(context: ToolContext): string {
    const token = randomBytes(32).toString("base64url");
    this.contexts.set(token, context);
    return token;
  }
  revoke(token: string) {
    this.contexts.delete(token);
  }
  get(token: string) {
    return this.contexts.get(token);
  }
  close() {
    this.contexts.clear();
  }
}

export interface McpHandlerDeps {
  tokens: TurnTokens;
  tools: CockpitTool[];
}

export function mcpHandler(deps: McpHandlerDeps) {
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp/cockpit") return null;
    const host = request.headers.get("host")?.split(":")[0]?.toLowerCase();
    if (host !== "127.0.0.1" && host !== "localhost")
      return Response.json({ error: "Host non consentito" }, { status: 403 });
    const authorization = request.headers.get("authorization") || "";
    const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{40,})$/);
    const context = match ? deps.tokens.get(match[1]!) : undefined;
    if (!context)
      return Response.json(
        { error: "Token turno non valido" },
        { status: 401 },
      );

    const server = new McpServer({ name: "cockpit", version: "1.0.0" });
    for (const tool of deps.tools) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        async (args) => ({ ...(await tool.handler(args, context)) }),
      );
    }
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: false,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      await server.close();
      return response;
    } catch (error) {
      await server.close().catch(() => {});
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 400 },
      );
    }
  };
}
