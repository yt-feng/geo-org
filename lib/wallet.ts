import { getD1 } from "./config";

export class WalletError extends Error {
  constructor(message: string, public status = 400, public code = "wallet_invalid") { super(message); this.name = "WalletError"; }
}

type WalletRequest = { userId: string; requestId: string; amountMicrousd: number; description?: string; metadata?: unknown };
type ReservationRow = { user_id: string; request_id: string; reserved_microusd: number; charged_microusd: number | null; status: "reserved" | "settled" | "refunded"; metadata_json: string };
export type WalletResult = { requestId: string; reservedMicrousd: number; chargedMicrousd: number | null; status: ReservationRow["status"]; reused: boolean };
export type WalletSnapshot = {
  currency: "USD"; balanceMicrousd: number; reservedMicrousd: number;
  ledger: Array<{ id: string; kind: string; amount_microusd: number; reference_id: string; description: string; created_at: string }>;
};

function identify(userId: string, requestId: string) {
  if (!userId || userId.length > 200 || !/^[A-Za-z0-9._:-]{1,200}$/.test(requestId)) throw new WalletError("账务请求编号无效。");
}
function amount(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000_000) throw new WalletError("账务金额无效。");
}
function metadata(value: unknown): string {
  const serialized = JSON.stringify(value ?? {});
  if (serialized.length > 16000) throw new WalletError("账务元数据过长。");
  return serialized;
}
function result(row: ReservationRow, reused: boolean): WalletResult {
  return { requestId: row.request_id, reservedMicrousd: row.reserved_microusd, chargedMicrousd: row.charged_microusd, status: row.status, reused };
}
async function reservation(userId: string, requestId: string): Promise<ReservationRow | null> {
  return getD1().prepare("SELECT * FROM wallet_reservations WHERE user_id=? AND request_id=?").bind(userId, requestId).first<ReservationRow>();
}
function normalizeError(cause: unknown): never {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.includes("insufficient_balance")) throw new WalletError("可用余额不足，请先充值。", 402, "insufficient_balance");
  if (message.includes("wallet_account_disabled")) throw new WalletError("账户已停用。", 403, "account_disabled");
  throw cause;
}

/** The insert and its balance trigger are one SQLite transaction. */
export async function reserveWallet(input: WalletRequest): Promise<WalletResult> {
  identify(input.userId, input.requestId); amount(input.amountMicrousd);
  const meta = metadata(input.metadata);
  let inserted;
  try {
    inserted = await getD1().prepare(`INSERT INTO wallet_reservations(user_id,request_id,reserved_microusd,description,metadata_json)
      VALUES(?,?,?,?,?) ON CONFLICT(user_id,request_id) DO NOTHING RETURNING request_id`)
      .bind(input.userId, input.requestId, input.amountMicrousd, (input.description || "API 调用预留").slice(0, 500), meta).first();
  } catch (cause) { normalizeError(cause); }
  const row = await reservation(input.userId, input.requestId);
  if (!row) throw new WalletError("账务请求未完成，请稍后重试。", 503, "wallet_unavailable");
  if (row.reserved_microusd !== input.amountMicrousd || row.metadata_json !== meta) throw new WalletError("相同账务编号不能用于不同请求。", 409, "wallet_request_conflict");
  return result(row, !inserted);
}

async function finishWallet(input: WalletRequest, status: "settled" | "refunded"): Promise<WalletResult> {
  identify(input.userId, input.requestId); amount(input.amountMicrousd);
  const before = await reservation(input.userId, input.requestId);
  if (!before) throw new WalletError("未找到此账户的预留记录。", 404, "wallet_reservation_missing");
  if (input.amountMicrousd > before.reserved_microusd) throw new WalletError("实际金额超过预留，等待账务核对。", 409, "settlement_exceeds_reservation");
  const updated = await getD1().prepare(`UPDATE wallet_reservations SET status=?,charged_microusd=?,description=?,updated_at=CURRENT_TIMESTAMP
    WHERE user_id=? AND request_id=? AND status='reserved' RETURNING request_id`)
    .bind(status, input.amountMicrousd, (input.description || (status === "settled" ? "API 调用结算，退回预留差额" : "调用未完成，退回预留金额")).slice(0, 500), input.userId, input.requestId).first();
  const row = await reservation(input.userId, input.requestId);
  if (!row || row.status !== status || row.charged_microusd !== input.amountMicrousd) throw new WalletError("此请求已按不同结果结算。", 409, "wallet_settlement_conflict");
  return result(row, !updated);
}

export function settleWallet(input: WalletRequest): Promise<WalletResult> { return finishWallet(input, "settled"); }
export function refundWallet(input: Omit<WalletRequest, "amountMicrousd">): Promise<WalletResult> { return finishWallet({ ...input, amountMicrousd: 0 }, "refunded"); }

export async function getWallet(userId: string): Promise<WalletSnapshot> {
  const db = getD1();
  const [account, pending, ledger] = await Promise.all([
    db.prepare("SELECT balance_microusd FROM wallet_accounts WHERE user_id=?").bind(userId).first<{ balance_microusd: number }>(),
    db.prepare("SELECT COALESCE(SUM(reserved_microusd),0) AS amount FROM wallet_reservations WHERE user_id=? AND status='reserved'").bind(userId).first<{ amount: number }>(),
    db.prepare("SELECT id,kind,amount_microusd,reference_id,description,created_at FROM wallet_ledger WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100").bind(userId).all<WalletSnapshot["ledger"][number]>(),
  ]);
  return { currency: "USD", balanceMicrousd: account?.balance_microusd ?? 0, reservedMicrousd: pending?.amount ?? 0, ledger: ledger.results || [] };
}
