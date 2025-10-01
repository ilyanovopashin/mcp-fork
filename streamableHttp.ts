import { createStreamableHttpApp } from "./streamableHttpApp.js";

console.error("Starting Streamable HTTP server...");

const { app, transports } = createStreamableHttpApp();

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  console.error(`MCP Streamable HTTP Server listening on port ${PORT}`);
});

const shutdown = async (signal: NodeJS.Signals) => {
  console.error(`Received ${signal}. Shutting down server...`);

  for (const [sessionId, context] of transports.entries()) {
    try {
      console.error(`Closing transport for session ${sessionId}`);
      await context.transport.close();
      await context.cleanup();
      transports.delete(sessionId);
    } catch (error) {
      console.error(`Error closing transport for session ${sessionId}:`, error);
    }
  }

  server.close(() => {
    console.error("Server shutdown complete");
    process.exit(0);
  });
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
