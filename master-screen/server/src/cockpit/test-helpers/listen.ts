// Starts a Node server on a free loopback port for a test, and closes it again.
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface Listening {
  url: string;
  port: number;
  close(): Promise<void>;
}

export async function listenLoopback(server: Server): Promise<Listening> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
