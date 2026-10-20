"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "./Icon";

type ResetState = "loading" | "confirm" | "ready" | "invalid" | "complete";
const confirmation = "如果该邮箱已注册，我们会发送密码重置邮件。请检查收件箱与垃圾邮件文件夹。";

async function recoveryRequest(path: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) throw new Error(typeof result?.error === "string" ? result.error : "请求未完成，请稍后重试。");
  return result;
}

export function PasswordRecoveryForm({ mode }: { mode: "forgot" | "reset" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [sent, setSent] = useState(false);
  const [resetState, setResetState] = useState<ResetState>("loading");
  const [showPassword, setShowPassword] = useState(false);
  const recoveryHash = useRef("");
  const initialized = useRef(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (mode !== "reset" || initialized.current) return;
    initialized.current = true;
    const location = new URL(window.location.href);
    const fragment = new URLSearchParams(location.hash.slice(1));
    const params = fragment.has("token_hash") ? fragment : location.searchParams;
    const tokenHash = params.get("token_hash") || "";
    const type = params.get("type");
    // Keep recovery material out of subsequent navigation and referrers.
    window.history.replaceState(null, "", location.pathname);
    if (tokenHash) {
      if (type !== "recovery" || !/^[A-Za-z0-9_-]{32,512}$/.test(tokenHash)) {
        queueMicrotask(() => setResetState("invalid")); return;
      }
      recoveryHash.current = tokenHash;
      queueMicrotask(() => setResetState("confirm"));
      return;
    }
    if (location.search || location.hash) { queueMicrotask(() => setResetState("invalid")); return; }
    // This only checks an existing HttpOnly recovery cookie; it does not redeem a link.
    void recoveryRequest("/api/auth/reset-password", {}).then(result => {
      setResetState(result.ready === true ? "ready" : "invalid");
    }).catch(() => setResetState("invalid"));
  }, [mode]);

  async function requestEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || sent) return;
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254) {
      setIsError(true); setMessage("请填写有效的注册邮箱。"); return;
    }
    inFlight.current = true; setPending(true); setMessage(""); setIsError(false);
    try {
      await recoveryRequest("/api/auth/forgot-password", { email: value });
      setSent(true); setMessage(confirmation);
    } catch (cause) {
      setIsError(true); setMessage(cause instanceof Error ? cause.message : "请求未完成，请稍后重试。");
    } finally { inFlight.current = false; setPending(false); }
  }

  async function verifyLink() {
    if (inFlight.current || resetState !== "confirm" || !recoveryHash.current) return;
    inFlight.current = true; setPending(true); setMessage(""); setIsError(false);
    try {
      const result = await recoveryRequest("/api/auth/reset-password", { tokenHash: recoveryHash.current });
      if (result.ready !== true) throw new Error("此重置链接暂不可用，请重新申请。");
      recoveryHash.current = ""; setResetState("ready");
    } catch (cause) {
      setIsError(true); setMessage(cause instanceof Error ? cause.message : "链接验证未完成，请重新申请。");
    } finally { inFlight.current = false; setPending(false); }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || resetState !== "ready") return;
    if (password.length < 10 || password.length > 512) {
      setIsError(true); setMessage("请使用 10–512 位的新密码。"); return;
    }
    if (password !== confirmPassword) { setIsError(true); setMessage("两次输入的密码不一致。"); return; }
    inFlight.current = true; setPending(true); setMessage(""); setIsError(false);
    try {
      const result = await recoveryRequest("/api/auth/reset-password", { password });
      if (result.passwordReset !== true) throw new Error("密码更新暂未确认，请稍后重试。");
      setPassword(""); setConfirmPassword(""); setResetState("complete");
      setMessage("密码已更新，请使用新密码登录。");
      window.location.assign("/login");
    } catch (cause) {
      setIsError(true); setMessage(cause instanceof Error ? cause.message : "密码更新未完成，请稍后重试。");
    } finally { inFlight.current = false; setPending(false); }
  }

  const notice = message ? <p className={isError ? "form-message error" : "form-message success"} role={isError ? "alert" : "status"}>{message}</p> : null;
  if (mode === "forgot") return <form className="auth-form" onSubmit={requestEmail}>
    <label><span>注册邮箱</span><input name="email" type="email" autoComplete="email" inputMode="email" placeholder="name@example.com" maxLength={254} required value={email} disabled={pending || sent} onChange={event => setEmail(event.target.value)} /></label>
    <button className="button button-primary auth-submit" disabled={pending || sent} type="submit">{pending ? "正在提交…" : sent ? "请求已提交" : "发送重置邮件"}<Icon name="arrow-right" size={15} /></button>
    {notice}<p className="auth-switch"><Link href="/login">返回登录</Link></p>
  </form>;

  return <div className="auth-form">
    {resetState === "loading" ? <p className="form-message" role="status">正在检查重置状态…</p> : null}
    {resetState === "confirm" ? <><p className="auth-intro">点击继续验证邮件中的链接，然后设置新密码。</p><button className="button button-primary auth-submit" type="button" disabled={pending} onClick={verifyLink}>{pending ? "正在验证…" : "继续验证"}<Icon name="arrow-right" size={15} /></button></> : null}
    {resetState === "invalid" ? <p className="form-message error" role="alert">此重置链接无效或已过期，请重新申请密码重置邮件。</p> : null}
    {resetState === "ready" ? <form className="auth-form" onSubmit={changePassword}>
      <label><span>新密码</span><div className="auth-password-wrap"><input name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={10} maxLength={512} placeholder="至少 10 位" required value={password} disabled={pending} onChange={event => setPassword(event.target.value)} /><button className="auth-password-toggle" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "隐藏密码" : "显示密码"}><Icon name={showPassword ? "shield" : "key"} size={15} /></button></div></label>
      <label><span>确认新密码</span><input name="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={10} maxLength={512} placeholder="再次输入新密码" required value={confirmPassword} disabled={pending} onChange={event => setConfirmPassword(event.target.value)} /></label>
      <button className="button button-primary auth-submit" type="submit" disabled={pending}>{pending ? "正在保存…" : "保存新密码"}<Icon name="arrow-right" size={15} /></button>
    </form> : null}
    {notice}
    <p className="auth-switch"><Link href="/forgot-password">重新申请重置邮件</Link><Link href="/login">返回登录</Link></p>
  </div>;
}
