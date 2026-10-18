import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const filename = new URL("../components/TokenHubAuditEvidence.tsx", import.meta.url).pathname;
const code = ts.transpileModule(await readFile(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const compiled = { exports: {} };
vm.runInNewContext(code, { module: compiled, exports: compiled.exports, Date, URLSearchParams, require(name) {
  if (name === "react") return React;
  if (name === "react/jsx-runtime") return jsx;
  if (name === "./Icon") return { Icon: props => React.createElement("svg", { "data-icon": props.name }) };
  throw new Error(`Unexpected dependency ${name}`);
} }, { filename });
const { AuditEvidenceDetail, TokenHubAuditEvidence, filterEvidenceRecords } = compiled.exports;
const campaign = { id: "d032e32c-09b6-4d3c-bbb8-eb10ddda8e08", startedAt: "2026-10-17T19:40:45Z", endsAt: "2026-10-24T19:40:45Z", planVersion: "tokenhub-audit-v3" };
const baseCase = { slot: 0, caseId: "glm-short", kind: "chat", requestedModel: "glm-5-2-260617", state: "succeeded", wasSubmitted: true, submittedAt: campaign.startedAt, updatedAt: campaign.startedAt, request: { model: "glm-5-2-260617", messages: [{ role: "user", content: "Compute A, B, C, D exactly." }], max_tokens: 8192, temperature: 0 }, response: { choices: [{ message: { content: '{"answers":[11,22,33,44],"nonce":"abc"}', reasoning_content: "Saved upstream reasoning only." }, finish_reason: "stop" }] }, expected: { answers: [11,22,33,44], nonce: "abc" }, grading: { status: "passed", correct: 4, total: 4, subitems: [true,true,true,true], score: 100 }, usage: { prompt_tokens: 100, completion_tokens: 50 }, billingActualMicros: null, billingVerification: "pending" };
function render(record = {}, media = [], tab = "conversation") { return renderToStaticMarkup(React.createElement(AuditEvidenceDetail, { evidence: { campaign, case: { ...baseCase, ...record }, media }, downloadUrl: "/api/admin/tokenhub-audit/evidence?download=1", initialTab: tab })); }

test("renders exact full request, final answer and returned reasoning without truncating or running markup", () => {
  const prompt = '<script>alert("not executable")</script>\n' + "x".repeat(100_000) + "PROMPT_END";
  const html = render({ request: { ...baseCase.request, messages: [{ role: "user", content: prompt }] } });
  assert.match(html, /实际发给 AI 的问题/);
  assert.match(html, /PROMPT_END/); assert.ok(html.includes("x".repeat(100_000)));
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
  assert.match(html, /11,22,33,44/); assert.match(html, /上游返回的推理内容/);
  assert.match(html, /Saved upstream reasoning only/); assert.match(html, /max_tokens/);
});
test("enveloped responses and alternative reasoning fields remain visible", () => {
  const html = render({ response: { data: { choices: [{ message: { content: "ENVELOPED_ANSWER", reasoning: "reasoning payload", reasoning_details: [{ text: "DETAILS_SAVED" }] }, finish_reason: "stop" }] } } });
  assert.match(html, /最终回答 · 原文/); assert.match(html, /ENVELOPED_ANSWER/); assert.match(html, /DETAILS_SAVED/);
});
test("timeout and never-submitted rows do not fabricate an AI answer", () => {
  const timeout = render({ state: "outcome_unknown", response: null, grading: null });
  assert.match(timeout, /未收到可保存的上游响应/); assert.doesNotMatch(timeout, /最终回答 · 原文/);
  const unsent = render({ state: "price_blocked", wasSubmitted: false, submittedAt: null, response: null, grading: null });
  assert.match(unsent, /留存请求参数 · 未发送/); assert.match(unsent, /请求未发出，没有 AI 返回内容/);
  assert.doesNotMatch(unsent, /实际发给 AI 的问题/);
});
test("failed image call exposes prompt and exact error with no invented image", () => {
  const html = render({ kind: "image", state: "provider_error", request: { prompt: "Red cube left, blue sphere right" }, response: { error: { message: "unsupported sequential_image_generation" } }, grading: null });
  assert.match(html, /Red cube left/); assert.match(html, /unsupported sequential_image_generation/);
  assert.match(html, /没有生成文件/); assert.doesNotMatch(html, /<img/);
});
test("saved video uses authenticated archive with controls; embedded image is not called temporary", () => {
  const url = `/api/admin/tokenhub-audit/media?asset=${"a".repeat(64)}`;
  const html = render({ kind: "video", request: { content: [{ type: "text", text: "One continuous static camera shot" }], duration: 4 }, response: { content: { video_url: "https://media.example/original.mp4" } }, grading: { status: "manual_review_pending" } }, [{ kind: "video", url, label: "生成视频", sourcePath: "response.content.video_url", storage: "archived", archive: { state: "archived", archivedAt: campaign.startedAt } }]);
  assert.match(html, /<video controls=""/); assert.ok(html.includes(url)); assert.match(html, /已归档到 ECO-GEO/); assert.doesNotMatch(html, /autoplay/i);
  const image = render({ kind: "image" }, [{ kind: "image", url: "data:image/png;base64,iVBORw0KGgo=", storage: "embedded", label: "生成图片", sourcePath: "response.data[0].b64_json" }]);
  assert.match(image, /<img/); assert.match(image, /图片内容已随底稿保存/); assert.doesNotMatch(image, /当前显示上游临时文件/);
});
test("unsafe media URLs are not rendered in players", () => {
  const html = render({ kind: "video" }, [{ kind: "video", url: "javascript:alert(1)", label: "bad", sourcePath: "response.content.video_url" }]);
  assert.doesNotMatch(html, /<video/); assert.match(html, /不支持内嵌预览/);
});
test("grading tab exposes per-item persisted checks while truncated outputs remain unscored", () => {
  const html = render({}, [], "grading");
  assert.match(html, /A · 状态运算/); assert.match(html, /B · 背包优化/); assert.match(html, /标准答案/); assert.match(html, />正确<\/td>/);
  const truncated = render({ grading: { status: "truncated", total: 0, score: null } }, [], "grading");
  assert.equal((truncated.match(/>未计分<\/td>/g) || []).length, 4);
  assert.doesNotMatch(truncated, />正确<\/td>/);
});
test("usage and raw tabs show missing bills honestly and expose full saved evidence", () => {
  const usage = render({}, [], "usage"); assert.match(usage, /待核对/); assert.match(usage, /prompt_tokens/);
  const raw = render({ requestHash: "request-checksum", responseHash: "response-checksum" }, [], "raw");
  assert.match(raw, /request-checksum/); assert.match(raw, /response-checksum/); assert.match(raw, /Compute A, B, C, D exactly/);
});
test("filters retain actual failures, separate unsent execution records, and return no invented future cases", () => {
  const records = [
    { slot: 0, caseId: "chat-short", model: "chat", kind: "chat", state: "succeeded", submittedAt: campaign.startedAt, updatedAt: campaign.startedAt, gradingStatus: "passed" },
    { slot: 0, caseId: "image", model: "image", kind: "image", state: "provider_error", submittedAt: campaign.startedAt, updatedAt: campaign.startedAt, gradingStatus: "" },
    { slot: 2, caseId: "video", model: "video", kind: "video", state: "price_blocked", submittedAt: "", updatedAt: campaign.startedAt, gradingStatus: "" },
  ];
  assert.equal(filterEvidenceRecords(records, { day: "all", model: "all", status: "submitted" }).length, 2);
  assert.equal(filterEvidenceRecords(records, { day: "all", model: "all", status: "unsent" })[0].caseId, "video");
  assert.equal(filterEvidenceRecords(records, { day: "6", model: "all", status: "all" }).length, 0);
  const html = renderToStaticMarkup(React.createElement(TokenHubAuditEvidence, { campaignId: campaign.id, startedAt: campaign.startedAt, records, models: [{ id: "video", name: "Video" }], initialFilter: { day: 6 } }));
  assert.match(html, /暂无已保存底稿/); assert.match(html, /未来计划不会显示成已完成检测/);
});
