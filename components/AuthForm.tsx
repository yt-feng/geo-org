"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState, type ReactNode } from "react";
import { useSiteLocale } from "./LocaleProvider";
import { Icon } from "@/components/Icon";
import { safeAuthReturnPath } from "@/lib/auth-return-path";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { t, href, isEnglish } = useSiteLocale();
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  useEffect(() => {
    if (mode !== "login") return;
    const url = new URL(window.location.href), fragment = new URLSearchParams(url.hash.slice(1));
    const sensitive = ["access_token", "refresh_token", "token_hash", "error", "error_code", "error_description"];
    if (url.searchParams.get("verified") !== "1" &&
      !sensitive.some(key => fragment.has(key) || url.searchParams.has(key))) return;
    const failed = ["error", "error_code", "error_description"]
      .some(key => fragment.has(key) || url.searchParams.has(key));
    // Email confirmation does not put provider bearer tokens into a visible URL
    // after arrival, or turn an untrusted browser fragment into an app session.
    window.history.replaceState(null, "", url.searchParams.get("lang") === "en" ? "/login?lang=en" : "/login");
    queueMicrotask(() => {
      setIsError(failed);
      setMessage(failed ? "邮箱验证链接已失效或未完成验证，请重新请求验证邮件。"
        : "邮箱验证链接已处理，请使用邮箱和密码登录。");
    });
  }, [mode]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setIsError(false);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = {
      email: String(form.get("email") || ""),
      password: String(form.get("password") || ""),
      displayName: String(form.get("displayName") || ""),
    };

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      let result: {
        error?: string;
        requiresEmailVerification?: boolean;
        authenticated?: boolean;
      };
      try { result = await response.json(); }
      catch { throw new Error("认证服务暂不可用，请稍后重试。"); }
      if (!result || typeof result !== "object") throw new Error("认证服务返回异常，请稍后重试。");
      if (!response.ok) throw new Error(result.error || "请求失败，请稍后再试。");

      if (mode === "login" || result.authenticated) {
        const destination = safeAuthReturnPath(new URL(window.location.href).searchParams.get("next"));
        window.location.assign(href(destination || "/dashboard"));
        return;
      }
      setMessage(
        result.requiresEmailVerification
          ? "注册请求已提交。请打开验证邮件完成邮箱确认，然后返回登录；如果该邮箱已注册，可直接登录。"
          : "账户已创建，现在可以登录。",
      );
      formElement.reset();
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "请求失败，请稍后再试。");
    } finally {
      setPending(false);
    }
  }

  const isLogin = mode === "login";
  return (
    <form className="auth-form" onSubmit={submit}>
      {!isLogin ? (
        <label>
          <span>{t("显示名称", "Display name")}</span>
          <input
            autoComplete="name"
            name="displayName"
            placeholder={t("你的名称", "Your name")}
            type="text"
          />
        </label>
      ) : null}
      <label>
        <span>{isLogin ? t("用户名或邮箱", "Username or email") : t("邮箱", "Email")}</span>
        <input
          autoComplete={isLogin ? "username" : "email"}
          inputMode={isLogin ? "text" : "email"}
          name="email"
          placeholder={isLogin ? t("输入用户名或邮箱", "Enter your username or email") : "name@example.com"}
          required
          type={isLogin ? "text" : "email"}
        />
      </label>
      <label>
        <span>{t("密码", "Password")}</span>
        <div className="auth-password-wrap">
        <input
          autoComplete={isLogin ? "current-password" : "new-password"}
          minLength={isLogin ? undefined : 10}
          maxLength={512}
          name="password"
          placeholder={isLogin ? t("输入密码", "Enter your password") : t("至少 10 位", "At least 10 characters")}
          required
          type={showPassword ? "text" : "password"}
        />
        <button type="button" className="auth-password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? t("隐藏密码", "Hide password") : t("显示密码", "Show password")}><Icon name={showPassword ? "shield" : "key"} size={15} /></button>
        </div>
      </label>
      {isLogin ? <p className="auth-switch"><Link href={href("/forgot-password")}>{t("忘记密码？", "Forgot password?")}</Link></p> : null}
      <button className="button button-primary auth-submit" disabled={pending} type="submit">
        {pending ? t("请稍候…", "Please wait…") : isLogin ? t("登录", "Log in") : t("创建账户", "Create account")}<Icon name="arrow-right" size={15} />
      </button>
      {message ? (
        <p className={isError ? "form-message error" : "form-message success"} role="status">
          {isEnglish ? authMessageEnglish(message) : message}
        </p>
      ) : null}
      <p className="auth-switch">
        {isLogin ? t("还没有账户？", "New to tokvilo?") : t("已经有账户？", "Already have an account?")}{" "}
        <Link href={href(isLogin ? "/register" : "/login")}>
          {isLogin ? t("立即注册", "Create an account") : t("返回登录", "Back to login")}
        </Link>
      </p>
    </form>
  );
}

export function AuthCopy({ zh, en }: { zh: ReactNode; en: ReactNode }) {
  const { isEnglish } = useSiteLocale();
  return <>{isEnglish ? en : zh}</>;
}

const authMessages: Record<string, string> = {
  "本站暂未开放新账户注册，请联系管理员。": "Registration is currently unavailable. Please contact support.",
  "邮箱注册暂未开启，请联系管理员。": "Email registration is currently unavailable. Please contact support.",
  "此邮箱地址无效，请检查后重试。": "Enter a valid email address.",
  "邮件服务暂不支持向此邮箱发送验证邮件，请联系管理员。": "We cannot send verification emails to this address right now. Please contact support.",
  "验证邮件发送过于频繁，请稍后再试。": "Too many verification email requests. Please try again later.",
  "请求过于频繁，请稍后再试。": "Too many requests. Please try again later.",
  "该邮箱已注册，请直接登录。": "Please log in with your existing account.",
  "请先打开验证邮件完成邮箱确认，再返回登录。": "Open your verification email to confirm your address, then return to log in.",
  "邮箱或密码不正确，请检查后重试。": "The email or password is incorrect. Please check and try again.",
  "密码强度不足，请使用更长且包含不同字符的密码。": "Choose a longer password with a variety of characters.",
  "注册验证未通过，请刷新页面重试或联系管理员。": "Registration verification failed. Refresh the page or contact support.",
  "注册服务需要额外验证，请联系管理员。": "Registration requires additional verification. Please contact support.",
  "信息未通过校验，请检查邮箱和密码。": "Check your email address and password, then try again.",
  "登录已过期，请重新登录。": "Your session has expired. Please log in again.",
  "恢复链接已失效或已使用，请重新申请找回密码。": "This recovery link has expired or has already been used. Request a new reset email.",
  "新密码不能与原密码相同，请换一个密码。": "Choose a password different from your current password.",
  "恢复授权已过期，请重新申请找回密码。": "Your recovery session has expired. Request a new reset email.",
  "邮箱验证链接已失效或未完成验证，请重新请求验证邮件。": "This verification link has expired or was not completed. Request a new verification email.",
  "邮箱验证链接已处理，请使用邮箱和密码登录。": "Your verification link has been processed. Log in with your email and password.",
  "注册请求已提交。请打开验证邮件完成邮箱确认，然后返回登录；如果该邮箱已注册，可直接登录。": "Your registration request was submitted. Open the verification email, then return to log in. If you already have an account, log in directly.",
  "账户已创建，现在可以登录。": "Your account has been created. You can now log in.",
  "请输入账号和密码。": "Enter your username or email and password.",
  "账号或密码格式不正确。": "Check your username or email and password.",
  "登录尝试过于频繁，请稍后重试。": "Too many login attempts. Please try again later.",
  "账号或密码不正确，或账号已停用。": "The credentials are incorrect or the account is unavailable.",
  "请输入有效的邮箱地址。": "Enter a valid email address.",
  "密码长度须为 10 至 512 位。": "Use a password between 10 and 512 characters.",
  "显示名称不能超过 100 个字符。": "Display names can contain up to 100 characters.",
  "操作过于频繁，请稍后再试。": "Too many requests. Please try again later.",
  "该邮箱已有本站账户，请直接登录；旧认证账户请联系管理员协助恢复。": "Try logging in with your existing account, or contact support for account recovery.",
  "注册会话返回不完整，请尝试登录。": "Registration could not be confirmed. Please try logging in.",
  "请填写有效的注册邮箱。": "Enter a valid email address.",
  "如果该邮箱已注册，我们会发送密码重置邮件。请检查收件箱与垃圾邮件文件夹。": "If an account exists for this email, we will send password reset instructions. Check your inbox and spam folder.",
  "此重置链接暂不可用，请重新申请。": "This reset link is unavailable. Request a new one.",
  "请使用 10–512 位的新密码。": "Use a new password between 10 and 512 characters.",
  "两次输入的密码不一致。": "The passwords do not match.",
  "密码更新暂未确认，请稍后重试。": "Your password update has not been confirmed. Please try again later.",
  "密码已更新，请使用新密码登录。": "Your password has been updated. Log in with your new password.",
  "重置链接已失效，请重新申请。": "This reset link has expired. Request a new one.",
  "恢复链接格式不正确，请重新申请找回密码。": "This recovery link is invalid. Request a new reset email.",
  "恢复请求格式不正确，请重新打开邮件中的链接。": "The recovery request is invalid. Open the link in your email again.",
  "密码修改结果暂无法确认，请先尝试用新密码登录，或重新申请恢复邮件。": "The password update could not be confirmed. Try logging in with your new password or request a new reset email.",
  "Email not confirmed": "Verify your email before logging in.",
  "Invalid login credentials": "The email or password is incorrect."
};
export function authMessageEnglish(message: string): string {
  return authMessages[message] || "We could not complete this request. Please try again later.";
}
