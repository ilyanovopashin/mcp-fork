import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createStreamableHttpApp } from "../streamableHttpApp.js";

type StreamableApp = ReturnType<typeof createStreamableHttpApp>;

declare global {
  // eslint-disable-next-line no-var
  var __mcpStreamableApp: StreamableApp | undefined;
}

const getApp = (): StreamableApp => {
  if (!globalThis.__mcpStreamableApp) {
    globalThis.__mcpStreamableApp = createStreamableHttpApp();
  }

  return globalThis.__mcpStreamableApp;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { app } = getApp();

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      res.off("finish", cleanup);
      res.off("close", cleanup);
      res.off("error", onError);
      resolve();
    };

    const onError = (error: unknown) => {
      res.off("finish", cleanup);
      res.off("close", cleanup);
      reject(error);
    };

    res.on("finish", cleanup);
    res.on("close", cleanup);
    res.on("error", onError);

    try {
      (app as unknown as (req: VercelRequest, res: VercelResponse) => void)(req, res);
    } catch (error) {
      onError(error);
    }
  });
}
