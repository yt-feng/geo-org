"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Icon } from "@/components/Icon";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

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
      const result = (await response.json()) as {
        error?: string;
        requiresEmailVerification?: boolean;
      };
      if (!response.ok) throw new Error(result.error || "请求失败，请稍后再试。");

      if (mode === "login") {
        window.location.assign("/dashboard");
        return;
      }
      setMessage(
        result.requiresEmailVerification
          ? "账户已创建。请打开验证邮件，然后返回登录。"
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
          <span>显示名称</span>
          <input
            autoComplete="name"
            name="displayName"
            placeholder="你的名称"
            type="text"
          />
        </label>
      ) : null}
      <label>
        <span>{isLogin ? "用户名或邮箱" : "邮箱"}</span>
        <input
          autoComplete={isLogin ? "username" : "email"}
          inputMode={isLogin ? "text" : "email"}
          name="email"
          placeholder={isLogin ? "输入用户名或邮箱" : "name@example.com"}
          required
          type={isLogin ? "text" : "email"}
        />
      </label>
      <label>
        <span>密码</span>
        <div className="auth-password-wrap">
        <input
          autoComplete={isLogin ? "current-password" : "new-password"}
          minLength={isLogin ? undefined : 10}
          name="password"
          placeholder={isLogin ? "输入密码" : "至少 10 位"}
          required
          type={showPassword ? "text" : "password"}
        />
        <button type="button" className="auth-password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "隐藏密码" : "显示密码"}><Icon name={showPassword ? "shield" : "key"} size={15} /></button>
        </div>
      </label>
      <button className="button button-primary auth-submit" disabled={pending} type="submit">
        {pending ? "请稍候…" : isLogin ? "登录" : "创建账户"}<Icon name="arrow-right" size={15} />
      </button>
      {message ? (
        <p className={isError ? "form-message error" : "form-message success"} role="status">
          {message}
        </p>
      ) : null}
      <p className="auth-switch">
        {isLogin ? "还没有账户？" : "已经有账户？"}{" "}
        <Link href={isLogin ? "/register" : "/login"}>
          {isLogin ? "立即注册" : "返回登录"}
        </Link>
      </p>
    </form>
  );
}
