import type { PortalUser } from "./auth";
import { getD1, numericEnv } from "./config";
import { safeEqual, sha256Hex } from "./crypto";

const PASSWORD_ITERATIONS = 100_000;
export const LOCAL_SESSION_MAX_AGE = 7 * 24 * 60 * 60;
const SESSION_PATTERN = /^tk_session_[a-f0-9]{64}$/;

export class LocalAuthError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
    this.name = "LocalAuthError";
  }
}

type LocalUserRow = {
  id: string;
  email: string;
  display_name: string;
  status: string;
};
type CredentialRow = LocalUserRow & {
  password_salt: string;
  password_hash: string;
  password_iterations: number;
  password_algorithm: string;
};

function userFromRow(row: LocalUserRow): PortalUser {
  // Local emails are login identifiers, not verified ownership or admin grants.
  return { id: row.id, email: row.email, displayName: row.display_name, isAdmin: false };
}

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^\S+@\S+\.\S+$/.test(email) ? email : null;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function derivePassword(password: string, salt: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(salt)) {
    throw new LocalAuthError("账户凭据暂不可用，请联系管理员。", 503, "local_auth_invalid_credentials");
  }
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"],
  );
  const bytes = Uint8Array.from(salt.match(/.{2}/g)!, (hex) => parseInt(hex, 16));
  // Workers WebCrypto supports this iteration count without requiring flags.
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", iterations: PASSWORD_ITERATIONS, salt: bytes },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(derived));
}

async function guarded<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof LocalAuthError) throw error;
    throw new LocalAuthError("账户服务暂时不可用，请稍后重试。", 503, "local_auth_unavailable");
  }
}

export async function createLocalAccount(input: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<PortalUser> {
  return guarded(async () => {
    const email = normalizedEmail(input?.email);
    if (!email || typeof input?.password !== "string" ||
      input.password.length < 10 || input.password.length > 512 ||
      (input.displayName !== undefined && typeof input.displayName !== "string") ||
      (input.displayName?.trim().length || 0) > 100) {
      throw new LocalAuthError("请检查邮箱、显示名称及密码（10 至 512 位）。", 400, "invalid_registration");
    }
    const db = getD1();
    const findExisting = () => db.prepare("SELECT id FROM users WHERE lower(trim(email)) = ? LIMIT 1")
      .bind(email).first<{ id: string }>();
    if (await findExisting()) {
      throw new LocalAuthError("该邮箱已有账户，请直接登录；旧账户请联系管理员协助恢复。", 409, "account_exists");
    }
    const id = `local_${crypto.randomUUID()}`;
    const displayName = input.displayName?.trim() || email.split("@")[0];
    const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    const hash = await derivePassword(input.password, salt);
    try {
      await db.batch([
        db.prepare(`INSERT INTO users(id,email,display_name,status,daily_limit)
          VALUES(?,?,?,'active',?)`).bind(id, email, displayName, numericEnv("DEFAULT_USER_DAILY_LIMIT", 100)),
        db.prepare(`INSERT INTO local_credentials(user_id,email,password_salt,password_hash,password_iterations)
          VALUES(?,?,?,?,?)`).bind(id, email, salt, hash, PASSWORD_ITERATIONS),
      ]);
    } catch (error) {
      // Resolve concurrent signup collisions without disclosing database errors.
      if (await findExisting()) {
        throw new LocalAuthError("该邮箱已有账户，请直接登录；旧账户请联系管理员协助恢复。", 409, "account_exists");
      }
      throw error;
    }
    return { id, email, displayName, isAdmin: false };
  });
}

export async function hasLocalAccount(value: string): Promise<boolean> {
  return guarded(async () => {
    const email = normalizedEmail(value);
    if (!email) return false;
    const row = await getD1().prepare("SELECT user_id FROM local_credentials WHERE email = ? LIMIT 1")
      .bind(email).first<{ user_id: string }>();
    // Include disabled accounts, so failed local login never falls back upstream.
    return Boolean(row);
  });
}

export async function authenticateLocalAccount(
  value: string,
  password: string,
): Promise<PortalUser | null> {
  return guarded(async () => {
    const email = normalizedEmail(value);
    if (!email || typeof password !== "string" || password.length < 10 || password.length > 512) return null;
    const row = await getD1().prepare(`SELECT u.id,u.email,u.display_name,u.status,
        c.password_salt,c.password_hash,c.password_iterations,c.password_algorithm
      FROM local_credentials c JOIN users u ON u.id=c.user_id
      WHERE c.email=? AND u.email=c.email LIMIT 1`).bind(email).first<CredentialRow>();
    if (row && (row.password_iterations !== PASSWORD_ITERATIONS ||
      row.password_algorithm !== "PBKDF2-SHA256" || !/^[a-f0-9]{64}$/.test(row.password_hash))) {
      throw new LocalAuthError("账户凭据暂不可用，请联系管理员。", 503, "local_auth_invalid_credentials");
    }
    // Match the KDF work on absent accounts without creating any stored state.
    const calculated = await derivePassword(password, row?.password_salt || "0".repeat(64));
    const matches = safeEqual(calculated, row?.password_hash || "0".repeat(64));
    return row && matches && row.status === "active" ? userFromRow(row) : null;
  });
}

export async function createLocalSession(userId: string): Promise<string> {
  return guarded(async () => {
    if (typeof userId !== "string" || !/^local_[a-f0-9-]{36}$/.test(userId)) {
      throw new LocalAuthError("请重新登录。", 401, "local_account_unavailable");
    }
    const token = `tk_session_${bytesToHex(crypto.getRandomValues(new Uint8Array(32)))}`;
    const hash = await sha256Hex(token);
    const expires = Math.floor(Date.now() / 1000) + LOCAL_SESSION_MAX_AGE;
    const result = await getD1().prepare(`INSERT INTO local_sessions(token_hash,user_id,expires_at)
      SELECT ?,u.id,? FROM users u JOIN local_credentials c ON c.user_id=u.id
      WHERE u.id=? AND u.status='active' AND u.email=c.email`).bind(hash, expires, userId).run();
    if (result.meta.changes !== 1) {
      throw new LocalAuthError("账户不可用，请重新登录或联系管理员。", 401, "local_account_unavailable");
    }
    return token;
  });
}

export async function verifyLocalSession(token: string): Promise<PortalUser | null> {
  return guarded(async () => {
    if (typeof token !== "string" || !SESSION_PATTERN.test(token)) return null;
    const row = await getD1().prepare(`SELECT u.id,u.email,u.display_name,u.status
      FROM local_sessions s JOIN local_credentials c ON c.user_id=s.user_id JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>unixepoch()
        AND u.status='active' AND u.email=c.email LIMIT 1`)
      .bind(await sha256Hex(token)).first<LocalUserRow>();
    return row ? userFromRow(row) : null;
  });
}

export async function revokeLocalSession(token: string): Promise<void> {
  return guarded(async () => {
    if (typeof token !== "string" || !SESSION_PATTERN.test(token)) return;
    await getD1().prepare(`UPDATE local_sessions SET revoked_at=unixepoch()
      WHERE token_hash=? AND revoked_at IS NULL`).bind(await sha256Hex(token)).run();
  });
}
