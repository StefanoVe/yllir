import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createCtx } from "../context.js";
import { createCampaignFramework, type ReviewQuery } from "./framework.js";

const REAL_FRAMEWORK = fileURLToPath(new URL("../../../../yllir", import.meta.url));

function campaign(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-review-"));
  fs.writeFileSync(path.join(root, "campaign.yaml"), "campaign:\n  name: Test\n  seed: Seme.md\nlanguage:\n  main: it\n");
  return root;
}

/** A fake query that answers with one successful result text, and records what it was asked. */
function answering(text: string, calls: Array<Parameters<ReviewQuery>[0]>): ReviewQuery {
  return async function* (args) {
    calls.push(args);
    yield { type: "result", subtype: "success", result: text } as unknown as SDKMessage;
  };
}

const batch = { drafts: ["NPCs/Ada.md"], finalFiles: ["NPCs/Ada.md"], intent: "Create the sheet" };

describe("cockpit review", () => {
  it("APPLY approves, asks the batch reviewer with the authoring keys, and saves the answer exactly", async () => {
    const root = campaign();
    const calls: Array<Parameters<ReviewQuery>[0]> = [];
    const answer = '{"outcome":"APPLY","items":[]}';
    const ctx = createCtx({ campaignRoot: root, frameworkRoot: REAL_FRAMEWORK, port: 0, log: () => {} });
    const framework = createCampaignFramework(ctx, { query: answering(answer, calls), findClaude: () => "/bin/claude" });
    const verdict = await framework.review!(batch);
    assert.deepEqual(verdict, { approved: true, objections: [] });
    assert.equal(fs.readFileSync(path.join(root, ".campaign/state/engine/review.json"), "utf8"), `${answer}\n`);
    const call = calls[0]!;
    assert.match(call.prompt, /yllir:batch-reviewer/);
    assert.match(call.prompt, /DRAFTS: NPCs\/Ada\.md/);
    assert.match(call.prompt, /FINAL_FILES: NPCs\/Ada\.md/);
    assert.match(call.prompt, /SEED: Seme\.md/);
    assert.match(call.prompt, /INTENT: Create the sheet/);
    assert.equal(call.options.cwd, root);
    assert.deepEqual(call.options.allowedTools, ["Agent", "Task", "Read", "Glob", "Grep"]);
    assert.equal(call.options.permissionMode, "dontAsk");
    assert.ok(call.options.disallowedTools?.includes("Write"));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("FIX is not approved: the objections come back as plain sentences and the answer is saved", async () => {
    const root = campaign();
    const answer = '{"outcome":"FIX","items":[{"file":"NPCs/Ada.md","problem":"Ada:3 says she is a guard.","fix":"Say she is a cook, as Ada:3 does."}]}';
    const ctx = createCtx({ campaignRoot: root, frameworkRoot: REAL_FRAMEWORK, port: 0, log: () => {} });
    const framework = createCampaignFramework(ctx, { query: answering(answer, []), findClaude: () => "/bin/claude" });
    const verdict = await framework.review!(batch);
    assert.equal(verdict.approved, false);
    assert.deepEqual(verdict.objections, ["Ada:3 says she is a guard. Say she is a cook, as Ada:3 does."]);
    assert.ok(fs.existsSync(path.join(root, ".campaign/state/engine/review.json")));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("an answer with prose around the JSON is refused, and an old review file is removed", async () => {
    const root = campaign();
    const file = path.join(root, ".campaign/state/engine/review.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"outcome":"APPLY","items":[]}');
    const ctx = createCtx({ campaignRoot: root, frameworkRoot: REAL_FRAMEWORK, port: 0, log: () => {} });
    const framework = createCampaignFramework(ctx, {
      query: answering('I checked: {"outcome":"APPLY","items":[]}', []),
      findClaude: () => "/bin/claude",
    });
    const verdict = await framework.review!(batch);
    assert.equal(verdict.approved, false);
    assert.equal(fs.existsSync(file), false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("a review that runs past the time limit is stopped and refused", async () => {
    const root = campaign();
    const ctx = createCtx({ campaignRoot: root, frameworkRoot: REAL_FRAMEWORK, port: 0, log: () => {} });
    const hanging: ReviewQuery = async function* (args) {
      await new Promise<void>((_resolve, reject) =>
        args.options.abortController!.signal.addEventListener("abort", () => reject(new Error("aborted"))),
      );
      yield {} as SDKMessage;
    };
    const framework = createCampaignFramework(ctx, { query: hanging, findClaude: () => "/bin/claude", reviewTimeoutMs: 20 });
    const verdict = await framework.review!(batch);
    assert.equal(verdict.approved, false);
    assert.match(verdict.objections[0]!, /too long/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("without Claude Code the review is refused before any query runs", async () => {
    const root = campaign();
    const calls: Array<Parameters<ReviewQuery>[0]> = [];
    const ctx = createCtx({ campaignRoot: root, frameworkRoot: REAL_FRAMEWORK, port: 0, log: () => {} });
    const framework = createCampaignFramework(ctx, { query: answering("{}", calls), findClaude: () => null });
    const verdict = await framework.review!(batch);
    assert.equal(verdict.approved, false);
    assert.equal(calls.length, 0);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
