import { createHash, webcrypto } from "node:crypto";
import { chmod, mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const DEFAULT_OAUTH_FILE = "/Users/ytfeng/Library/Preferences/.wrangler/config/default.toml";
const invariant = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = value => createHash("sha256").update(value).digest("hex");

async function savePrivate(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(filename), 0o700);
  const temporary = filename + ".tmp";
  const handle = await open(temporary, "w", 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + "\n"); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, filename); await chmod(filename, 0o600);
}

/** The token is captured in memory, never returned, persisted or logged. */
export function remoteD1({ accountId, databaseId, token, fetcher = fetch }) {
  invariant(/^[a-f0-9]{32}$/.test(accountId), "Invalid Cloudflare account identifier.");
  invariant(/^[a-f0-9-]{36}$/.test(databaseId), "Invalid D1 database identifier.");
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  async function query(body) {
    let response;
    try {
      response = await fetcher(endpoint, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(45_000) });
    } catch { throw new Error("Cloudflare transport outcome is unknown. Re-run this same QA run ID to inspect and recover; no automatic mutation retry was made."); }
    let payload;
    try { payload = await response.json(); } catch { throw new Error("Cloudflare returned an unreadable response. Inspect this QA run before retrying."); }
    if (!response.ok || payload.success === false || !Array.isArray(payload.result) || payload.result.some(item => item.success === false)) {
      const codes = (payload.errors || []).map(item => Number(item.code)).filter(Number.isFinite).join(",");
      throw new Error(`D1 request failed (HTTP ${response.status}${codes ? `, codes ${codes}` : ""}); query text and credentials omitted.`);
    }
    return payload.result;
  }
  return {
    prepare(sql) {
      function statement(params = []) {
        return {
          query: { sql, params },
          bind(...values) { return statement(values); },
          async first() { return (await query({ sql, params }))[0]?.results?.[0] ?? null; },
          async all() { return (await query({ sql, params }))[0]; },
          async run() { return (await query({ sql, params }))[0]; },
        };
      }
      return statement();
    },
    async batch(statements) {
      // Cloudflare's documented REST contract is {batch:[{sql,params},...]};
      // keep the whole application batch in one API call.
      const results = await query({ batch: statements.map(statement => statement.query) });
      invariant(results.length === statements.length, "D1 batch returned an unexpected number of results.");
      return results;
    },
  };
}

async function loadActualModule(filename, mocks) {
  const source = await readFile(filename, "utf8");
  const { outputText } = ts.transpileModule(source, { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const compiled = { exports: {} };
  vm.runInNewContext(outputText, {
    module: compiled, exports: compiled.exports,
    require(name) { if (Object.hasOwn(mocks, name)) return mocks[name]; throw new Error(`QA module dependency not allowed: ${name}`); },
    crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, URL, Request, Response, Headers,
    fetch() { throw new Error("Provider/network calls are disabled inside the QA application modules."); },
  }, { filename });
  return { exports: compiled.exports, hash: sha256(source) };
}

/** Run only against the two named QA identities; preserve all resulting audit. */
export async function runVerification({ DB, vars, runId, codeRoot = process.cwd(), artifactsRoot = codeRoot }) {
  invariant(/^[a-zA-Z0-9_-]{8,60}$/.test(runId || ""), "Use a stable 8–60 character --run-id.");
  const directory = path.join(artifactsRoot, ".artifacts", "tokvilo-private", "qa", runId);
  const statePath = path.join(directory, "state.json"), reportPath = path.join(directory, "report.json");
  let state;
  try { state = JSON.parse(await readFile(statePath, "utf8")); }
  catch (cause) { if (cause.code !== "ENOENT") throw new Error("The private QA checkpoint is unreadable; preserve and repair it before retrying."); }
  if (!state) {
    state = { runId, operatorId: `qa-${runId}-admin`, buyerId: `qa-${runId}-buyer`, requestId: `qa-issue-${runId}`, walletId: `qa:${runId}:settlement`, startedAt: new Date().toISOString() };
    await savePrivate(statePath, state);
  }
  invariant(state.runId === runId && state.operatorId === `qa-${runId}-admin` && state.buyerId === `qa-${runId}-buyer`, "QA checkpoint identity mismatch.");
  const operator = { id: state.operatorId, email: `${state.operatorId}@tokvilo.invalid`, displayName: "Tokvilo QA operator — no sale", isAdmin: true };
  const buyer = { id: state.buyerId, email: `${state.buyerId}@tokvilo.invalid`, displayName: "Tokvilo QA buyer — no sale", isAdmin: false };
  let currentUser = buyer;
  const env = { ...vars, DB };
  const config = {
    getD1: () => DB, runtimeEnv: () => env,
    numericEnv: (name, fallback, minimum = 1) => Number.isFinite(Number(env[name])) && Number(env[name]) >= minimum ? Math.floor(Number(env[name])) : fallback,
    decimalEnv: (name, fallback, minimum = 0) => Number.isFinite(Number(env[name])) && Number(env[name]) >= minimum ? Number(env[name]) : fallback,
  };
  const walletSource = await loadActualModule(path.join(codeRoot, "lib/wallet.ts"), { "./config": config });
  const storeSource = await loadActualModule(path.join(codeRoot, "lib/store.ts"), { "./config": config });
  const productsSource = await loadActualModule(path.join(codeRoot, "lib/products.ts"), {});
  const wallet = walletSource.exports, ensureUser = storeSource.exports.ensureUser;
  const common = { "./config": config, "./wallet": wallet, "./store": { ensureUser }, "./auth": { getPortalUser: async () => currentUser } };
  const redemptionSource = await loadActualModule(path.join(codeRoot, "lib/redemption.ts"), { ...common, "./crypto": { sha256Hex: async value => sha256(value) } });
  const ordersSource = await loadActualModule(path.join(codeRoot, "lib/orders.ts"), { ...common, "./products": productsSource.exports });
  const redemption = redemptionSource.exports;
  const report = {
    runId, scope: "production_D1_actual_modules_with_injected_QA_sessions",
    noRealPayment: true, noProviderCalls: true, noProductionAdminCredentials: true,
    sourceHashes: { wallet: walletSource.hash, redemption: redemptionSource.hash, orders: ordersSource.hash, store: storeSource.hash, products: productsSource.hash },
    steps: [], cleanup: null, completed: false,
  };
  const step = async (name, details = {}) => { report.steps.push({ name, ...details }); await savePrivate(reportPath, report); };
  async function handleRedemption(action, payload, user) {
    currentUser = user;
    const response = await redemption.handleWalletRequest(new Request("https://tokvilo.com/api/wallet", { method: payload ? "POST" : "GET", headers: { origin: "https://tokvilo.com", "content-type": "application/json" }, ...(payload ? { body: JSON.stringify(payload) } : {}) }), action);
    const data = await response.json();
    invariant(response.ok, `QA redemption step '${action}' failed with HTTP ${response.status}.`);
    return data;
  }
  async function handleOrder(method, payload, user, admin = false) {
    currentUser = user;
    const response = await ordersSource.exports.handleOrders(new Request("https://tokvilo.com/api/orders", { method, headers: { origin: "https://tokvilo.com", "content-type": "application/json", "Idempotency-Key": `qa-order-${runId}` }, ...(payload ? { body: JSON.stringify(payload) } : {}) }), admin);
    const data = await response.json();
    invariant(response.ok, `QA order step '${method}' failed with HTTP ${response.status}.`);
    return data;
  }
  async function snapshot() {
    const [account, codes, grants, reversals, pending, users] = await Promise.all([
      DB.prepare("SELECT balance_microusd FROM wallet_accounts WHERE user_id=?").bind(buyer.id).first(),
      DB.prepare("SELECT c.status,COUNT(*) AS count FROM tokvilo_redemption_codes c JOIN tokvilo_redemption_batches b ON b.id=c.batch_id WHERE b.request_id=? AND b.created_by=? GROUP BY c.status").bind(state.requestId, operator.id).all(),
      DB.prepare("SELECT COUNT(*) AS count FROM wallet_ledger WHERE user_id=? AND kind='redemption'").bind(buyer.id).first(),
      DB.prepare("SELECT COUNT(*) AS count FROM wallet_ledger WHERE user_id=? AND kind='redemption_reversal'").bind(buyer.id).first(),
      DB.prepare("SELECT COUNT(*) AS count FROM wallet_reservations WHERE user_id=? AND status='reserved'").bind(buyer.id).first(),
      DB.prepare("SELECT status,COUNT(*) AS count FROM users WHERE id IN (?,?) GROUP BY status").bind(buyer.id, operator.id).all(),
    ]);
    return { balanceMicrousd: account?.balance_microusd || 0, codeStates: codes.results, grants: grants?.count || 0, reversals: reversals?.count || 0, pendingReservations: pending?.count || 0, userStates: users.results };
  }
  async function cleanup() {
    // If execution stopped after an order was created, cancel that QA order.
    const orders = await DB.prepare("SELECT id FROM digital_orders WHERE user_id=? AND request_key=? AND status IN ('pending','processing')").bind(buyer.id, `qa-order-${runId}`).all();
    for (const order of orders.results || []) await handleOrder("PATCH", { id: order.id, action: "cancel" }, operator, true);
    const held = await DB.prepare("SELECT request_id FROM wallet_reservations WHERE user_id=? AND status='reserved'").bind(buyer.id).all();
    for (const row of held.results || []) await wallet.refundWallet({ userId: buyer.id, requestId: row.request_id, description: `QA ${runId}: release unused test reservation; no real payment` });
    // The synthetic successful usage charge is restored by a clearly labeled
    // QA adjustment, not represented as a customer payment or monetary refund.
    await DB.prepare(`INSERT INTO wallet_ledger(id,user_id,kind,amount_microusd,reference_id,description)
      SELECT ?,user_id,'qa_adjustment',charged_microusd,request_id,?
      FROM wallet_reservations WHERE user_id=? AND request_id=? AND status='settled'
      ON CONFLICT(id) DO NOTHING`).bind(`qa-restore:${runId}`, `QA ${runId}: restore synthetic test debit; no sale or cash refund`, buyer.id, state.walletId).run();
    if (state.code) {
      await handleRedemption("revoke", { code: state.code, note: `QA ${runId}: retire test code; never uploaded or sold` }, operator);
    } else {
      // A lost first issuance response can leave only hash records. It cannot
      // have been redeemed by this run, so retire its unclaimed inventory.
      await DB.batch([
        DB.prepare(`INSERT INTO tokvilo_redemption_revocations(code_id,actor_id,note,credit_reversed_microusd,created_at)
          SELECT c.id,?,?,0,CURRENT_TIMESTAMP FROM tokvilo_redemption_codes c JOIN tokvilo_redemption_batches b ON b.id=c.batch_id
          WHERE b.request_id=? AND b.created_by=? AND c.status='available' ON CONFLICT(code_id) DO NOTHING`).bind(operator.id, `QA ${runId}: unclaimed response-loss cleanup`, state.requestId, operator.id),
        DB.prepare(`UPDATE tokvilo_redemption_codes SET status='revoked'
          WHERE status='available' AND batch_id IN(SELECT id FROM tokvilo_redemption_batches WHERE request_id=? AND created_by=?)`).bind(state.requestId, operator.id),
      ]);
    }
    await DB.prepare("UPDATE users SET status='disabled',updated_at=CURRENT_TIMESTAMP WHERE id IN (?,?)").bind(buyer.id, operator.id).run();
    const final = await snapshot();
    invariant(final.balanceMicrousd === 0, "QA cleanup did not restore a zero balance.");
    invariant(final.pendingReservations === 0, "QA cleanup left a reservation pending.");
    invariant((final.codeStates || []).every(row => row.status === "revoked"), "QA cleanup left an active code.");
    invariant(final.userStates.length === 1 && final.userStates[0].status === "disabled" && final.userStates[0].count === 2, "QA cleanup did not disable both QA users.");
    report.cleanup = final;
    await savePrivate(reportPath, report);
  }
  if (state.finished) {
    invariant(state.verificationPassed, "This QA run was cleaned up after a failure. Inspect its private report and use a new run ID.");
    report.cleanup = await snapshot(); report.completed = report.cleanup.balanceMicrousd === 0 && report.cleanup.pendingReservations === 0 && report.cleanup.grants === 1 && report.cleanup.reversals === 1 && report.cleanup.codeStates?.length === 1 && report.cleanup.codeStates[0].status === "revoked" && report.cleanup.codeStates[0].count === 1;
    invariant(report.completed, "A completed QA checkpoint no longer matches D1. Inspect its records before continuing.");
    return { ...report, alreadyCompleted: true, reportPath };
  }
  let failure = null;
  try {
    invariant(env.REDEMPTION_ENABLED === "true" && env.REDEMPTION_ISSUANCE_ENABLED === "true", "QA requires the configured redemption and issuance switches to be enabled.");
    await ensureUser(operator); await ensureUser(buyer);
    await DB.prepare("UPDATE users SET status='active',updated_at=CURRENT_TIMESTAMP WHERE id IN (?,?)").bind(operator.id, buyer.id).run();
    await step("isolated_QA_accounts_ready");
    if (!state.code) {
      const issued = await handleRedemption("batches", { packageId: "300", count: 1, note: `QA ${runId}: no sale, never upload to merchant inventory`, requestId: state.requestId }, operator);
      invariant(issued.codesAvailable === true && issued.codes.length === 1, "The QA issuance already exists but its private plaintext is unavailable. Cleanup will retire it; use a new run ID after inspection.");
      state.code = issued.codes[0]; state.batchId = issued.batch.id; state.creditMicrousd = issued.batch.credit_microusd;
      await savePrivate(statePath, state);
    }
    await step("one_QA_code_issued", { amountCny: 300, creditMicrousd: state.creditMicrousd });
    const first = await handleRedemption("redeem", { code: state.code }, buyer);
    const replay = await handleRedemption("redeem", { code: state.code }, buyer);
    invariant(replay.alreadyRedeemed === true, "QA redemption replay was not recognized.");
    invariant(first.wallet.balanceMicrousd === state.creditMicrousd && replay.wallet.balanceMicrousd === state.creditMicrousd, "QA redemption did not credit exactly once.");
    await step("redemption_and_replay", { creditedOnce: true });
    const held = await wallet.reserveWallet({ userId: buyer.id, requestId: state.walletId, amountMicrousd: 1_000_000, description: `QA ${runId}: synthetic usage reserve`, metadata: { qa: true, runId } });
    invariant(held.status === "reserved" || held.status === "settled", "QA usage reservation has unexpected state.");
    const settled = await wallet.settleWallet({ userId: buyer.id, requestId: state.walletId, amountMicrousd: 600_000, description: `QA ${runId}: synthetic usage debit; no provider request` });
    const settledAgain = await wallet.settleWallet({ userId: buyer.id, requestId: state.walletId, amountMicrousd: 600_000, description: `QA ${runId}: synthetic usage replay` });
    invariant(settled.status === "settled" && settledAgain.reused && settledAgain.chargedMicrousd === 600_000, "QA settlement replay changed its charge.");
    invariant((await wallet.getWallet(buyer.id)).balanceMicrousd === state.creditMicrousd - 600_000, "QA settlement balance is incorrect.");
    await step("reserve_settle_replay", { reservedMicrousd: 1_000_000, chargedMicrousd: 600_000, replayChangedBalance: false });
    const product = productsSource.exports.digitalProducts.filter(item => !item.soldOut).sort((a, b) => a.retailCents - b.retailCents)[0];
    invariant(product, "No available product exists for the cancellation test.");
    const payload = { productId: product.id, confirmed: true, expectedRetailCents: product.retailCents, expectedChargeMicrousd: Math.ceil(product.retailCents * 10000 / Number(env.USD_CNY)) };
    const created = await handleOrder("POST", payload, buyer);
    const reused = await handleOrder("POST", payload, buyer);
    invariant(created.order.id === reused.order.id && reused.reused, "QA order replay created another order.");
    const cancelled = await handleOrder("PATCH", { id: created.order.id, action: "cancel" }, buyer);
    const cancelledAgain = await handleOrder("PATCH", { id: created.order.id, action: "cancel" }, buyer);
    invariant(cancelled.order.status === "cancelled" && cancelledAgain.reused, "QA order cancellation replay changed state.");
    invariant((await wallet.getWallet(buyer.id)).balanceMicrousd === state.creditMicrousd - 600_000, "QA cancellation did not return the complete hold.");
    await step("order_creation_and_cancel_replays", { orderCancelled: true, fullReservationReleased: true });
  } catch (cause) {
    failure = cause instanceof Error ? cause.message : "QA verification failed.";
    report.failure = failure;
  } finally {
    try { await cleanup(); }
    catch (cause) { report.cleanupFailure = cause instanceof Error ? cause.message : "QA cleanup failed."; }
    report.completed = !failure && !!report.cleanup && report.cleanup.grants === 1 && report.cleanup.reversals === 1 && report.cleanup.codeStates?.length === 1 && report.cleanup.codeStates[0].status === "revoked" && report.cleanup.codeStates[0].count === 1;
    state.finished = !!report.cleanup;
    state.verificationPassed = report.completed;
    await savePrivate(statePath, state); await savePrivate(reportPath, report);
  }
  if (!report.completed) throw new Error(`QA verification did not complete. Inspect private report: ${reportPath}`);
  return { ...report, reportPath };
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const runIndex = args.indexOf("--run-id"), runId = runIndex < 0 ? "qa-wallet-20261020" : args[runIndex + 1];
  const accountIndex = args.indexOf("--account-id");
  invariant(args.every((value, index) => ["--execute", "--plan", "--run-id", "--account-id"].includes(value) || index === runIndex + 1 || index === accountIndex + 1), "Usage: node scripts/verify-tokvilo-wallet-remote.mjs --plan|--execute --run-id qa-wallet-20261020 [--account-id ACCOUNT_ID]");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const configText = await readFile(path.join(root, "wrangler.jsonc"), "utf8");
  const parsed = ts.parseConfigFileTextToJson("wrangler.jsonc", configText);
  invariant(!parsed.error, "wrangler.jsonc is not valid JSONC.");
  const config = parsed.config;
  const database = config.d1_databases?.find(item => item.binding === "DB");
  const accountId = accountIndex < 0 ? config.account_id || process.env.CLOUDFLARE_ACCOUNT_ID : args[accountIndex + 1];
  invariant(database?.database_id, "D1 binding is missing from wrangler.jsonc.");
  if (!execute) {
    process.stdout.write(JSON.stringify({
      mode: "plan_only_no_credentials_read_no_remote_requests", runId, databaseName: database.database_name,
      steps: ["Create isolated QA operator and buyer", "Issue one CNY 300 QA code", "Redeem and replay", "Reserve USD 1, settle USD 0.60 and replay", "Create and cancel one confirmed product order; replay", "Restore synthetic USD 0.60 via labeled QA adjustment", "Revoke QA code; disable QA identities", "Verify zero balance, no pending reservations, one grant/reversal; retain all audit"],
      authScope: "Actual modules with injected QA sessions over production D1; real HTTP authentication is not tested",
      providerCalls: 0, realPayments: 0, productionAdminCredentials: "not accessed",
      accountConfigured: !!accountId,
      invocation: `node scripts/verify-tokvilo-wallet-remote.mjs --execute --run-id ${runId}${config.account_id || process.env.CLOUDFLARE_ACCOUNT_ID ? "" : ` --account-id ${accountId || "ACCOUNT_ID"}`}`,
    }, null, 2) + "\n");
    return;
  }
  invariant(accountId, "Pass --account-id or set CLOUDFLARE_ACCOUNT_ID; no credential was read.");
  const oauth = await readFile(DEFAULT_OAUTH_FILE, "utf8");
  const token = oauth.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  invariant(token, "Wrangler OAuth credential is unavailable.");
  const DB = remoteD1({ accountId, databaseId: database.database_id, token });
  const result = await runVerification({ DB, vars: config.vars, runId, codeRoot: root });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(cause => {
  process.stderr.write((cause instanceof Error ? cause.message : "QA script failed.") + "\n"); process.exitCode = 1;
});
