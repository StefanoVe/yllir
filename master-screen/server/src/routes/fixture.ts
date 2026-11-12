// Test helper: a campaign folder with its own campaign.yaml, a fake framework, and the real app
// on a loopback port. Records the events published on the bus. Used only by *.test.ts files.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { createCtx, type Ctx } from '../context.js';
import { makeFakeFramework, type FakeFramework } from '../fake-framework.js';
import { request, startServer, type RunningServer, type TestResponse } from '../testing.js';

export interface Fixture {
  root: string;
  fake: FakeFramework;
  ctx: Ctx;
  port: number;
  /** Bus events published since the fixture opened, by name. */
  events: string[];
  call(method: string, urlPath: string, body?: unknown): Promise<TestResponse>;
  close(): Promise<void>;
}

export function yamlWithModules(modules: { encyclopedia: boolean; print: boolean; music?: boolean }, language = 'en'): string {
  return [
    'schema: 1',
    'campaign:',
    '  name: Test Campaign',
    '  slug: test-campaign',
    'language:',
    `  main: ${language}`,
    'modules:',
    `  encyclopedia: ${modules.encyclopedia}`,
    `  print: ${modules.print}`,
    ...(modules.music !== undefined ? [`  music: ${modules.music}`] : []),
    '',
  ].join('\n');
}

export async function openFixture(yaml: string): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-campaign-'));
  await fs.writeFile(path.join(root, 'campaign.yaml'), yaml, 'utf8');
  const fake = await makeFakeFramework();
  const events: string[] = [];
  let ctx!: Ctx;
  const server: RunningServer = await startServer((port) => {
    ctx = createCtx({ campaignRoot: root, frameworkRoot: fake.frameworkRoot, port, log: () => {} });
    const bus = ctx.bus as unknown as { publish: (event: string, data: unknown) => number };
    const original = bus.publish.bind(ctx.bus);
    bus.publish = (event, data) => {
      events.push(event);
      return original(event, data);
    };
    return createApp(ctx);
  });
  return {
    root,
    fake,
    ctx,
    port: server.port,
    events,
    call(method, urlPath, body) {
      const headers: Record<string, string> = { host: `127.0.0.1:${server.port}` };
      if (body !== undefined) headers['content-type'] = 'application/json';
      return request(server.port, {
        method,
        path: urlPath,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    },
    async close() {
      await server.close();
      await fake.cleanup();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
