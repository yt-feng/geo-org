import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { billingSummary } from "./helpers/credit-display.mjs";

const render = (response, locale = "en") => renderToStaticMarkup(createElement(billingSummary.PlaygroundBillingSummary, { response, locale }));
const text = html => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("settlement displays exact credits and USD separately from unchanged actual token usage", () => {
  const receipt = { choices: [{ message: { content: "Result" } }], usage: { prompt_tokens: 8192, completion_tokens: 79, total_tokens: 8271 }, tokvilo_billing: { status: "settled", reservedMicrousd: 18000, chargedMicrousd: 1, currency: "USD" } };
  const original = JSON.stringify(receipt);
  const english = text(render(receipt));
  assert.match(english, /Reservation 18 credits \(\$0\.018\)/);
  assert.match(english, /Actual charge 0\.001 credits \(\$0\.000001\)/);
  assert.match(english, /Input tokens 8,192/); assert.match(english, /Output tokens 79/); assert.match(english, /Total tokens 8,271/);
  assert.match(english, /reservation is not the final charge/);
  assert.doesNotMatch(english, /8,192 credits|8,271 credits/);
  const chinese = text(render(receipt, "zh"));
  assert.match(chinese, /实际费用 0\.001 积分 \(\$0\.000001\)/);
  assert.equal(JSON.stringify(receipt), original);
});

test("pending and unrecognized settlements never present stale charge numbers as final", () => {
  for (const status of ["reserved", "awaiting_reconciliation", "pending_confirmation", "unknown"]) {
    const output = text(render({ tokvilo_billing: { status, currency: "USD", reservedMicrousd: 12500, chargedMicrousd: 9000 } }));
    assert.match(output, /12\.5 credits \(\$0\.0125\)/);
    assert.match(output, /Actual charge Awaiting settlement/);
    assert.doesNotMatch(output, /9 credits|\$0\.009|0 credits/);
  }
});

test("confirmed refunds show a true zero charge and distinguish the released reservation", () => {
  const output = text(render({ tokvilo_billing: { status: "refunded", currency: "USD", reservedMicrousd: 15000, chargedMicrousd: 0 } }));
  assert.match(output, /Reservation 15 credits \(\$0\.015\)/);
  assert.match(output, /Actual charge 0 credits \(\$0\)/);
  assert.match(output, /reservation has been released/);
  assert.match(text(render({ tokvilo_billing: { status: "refunded", currency: "USD", chargedMicrousd: 1 } })), /Awaiting settlement/);
});

test("malformed or non-USD amounts are not converted and missing tokens are not estimated", () => {
  for (const value of ["3000", 0.1, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    const output = text(render({ tokvilo_billing: { currency: "USD", status: "settled", chargedMicrousd: value, reservedMicrousd: value }, usage: { total_tokens: value } }));
    assert.match(output, /Awaiting settlement/); assert.doesNotMatch(output, /credits \(|Total tokens/);
  }
  assert.doesNotMatch(text(render({ tokvilo_billing: { currency: "CNY", status: "settled", chargedMicrousd: 16200 } })), /credits \(/);
  assert.equal(render({ choices: [] }), "");
  const usage = text(render({ data: { usage: { input_tokens: 2, output_tokens: 3 } } }));
  assert.match(usage, /Input tokens 2/); assert.match(usage, /Output tokens 3/); assert.doesNotMatch(usage, /Total tokens|Actual charge/);
});
