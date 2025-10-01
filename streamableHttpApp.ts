import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";
import express, { Request, Response } from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { createServer } from "./everything.js";

type SessionContext = {
  transport: StreamableHTTPServerTransport;
  cleanup: () => Promise<void>;
};

export function createStreamableHttpApp() {
  const app = express();
  app.use(
    cors({
      origin: "*",
      methods: "GET,POST,DELETE",
      preflightContinue: false,
      optionsSuccessStatus: 204,
      exposedHeaders: [
        "mcp-session-id",
        "last-event-id",
        "mcp-protocol-version",
      ],
    }),
  );

  const transports: Map<string, SessionContext> = new Map();

  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId)!.transport;
      } else if (!sessionId) {
        const { server, cleanup, startNotificationIntervals } = createServer();
        const eventStore = new InMemoryEventStore();

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          eventStore,
          onsessioninitialized: (initializedSessionId: string) => {
            console.error(`Session initialized with ID: ${initializedSessionId}`);
            transports.set(initializedSessionId, { transport, cleanup });
          },
        });

        server.onclose = async () => {
          const sid = transport.sessionId;
          if (sid && transports.has(sid)) {
            transports.delete(sid);
          }
          await cleanup();
        };

        await server.connect(transport);
        await transport.handleRequest(req, res);
        startNotificationIntervals(transport.sessionId);
        return;
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided",
          },
          id: req?.body?.id,
        });
        return;
      }

      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling MCP POST request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: req?.body?.id,
        });
      }
    }
  });

  app.get("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: req?.body?.id,
      });
      return;
    }

    const { transport } = transports.get(sessionId)!;
    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling MCP GET request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: req?.body?.id,
        });
      }
    }
  });

  app.delete("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: req?.body?.id,
      });
      return;
    }

    const context = transports.get(sessionId)!;
    try {
      await context.transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling MCP DELETE request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Error handling session termination",
          },
          id: req?.body?.id,
        });
      }
    } finally {
      transports.delete(sessionId);
      try {
        await context.cleanup();
      } catch (error) {
        console.error("Error cleaning up session:", error);
      }
    }
  });

  return { app, transports };
}
