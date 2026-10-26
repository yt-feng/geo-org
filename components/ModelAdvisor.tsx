"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { recommendModels, isGuidanceAnswers } from "@/lib/model-guidance";
import { modelWorkbenchUrl, type CatalogModel } from "@/lib/model-catalog";
import { selectionModels, selectionPrices, publicService, type SelectionPricing } from "@/lib/model-selection-ui";
import { CREDIT_EXCHANGE_LABEL, formatCreditsWithUsd } from "@/lib/credits";
import { ProviderLogo } from "./ProviderLogo";
import { useSiteLocale } from "./LocaleProvider";

type Answers = Parameters<typeof recommendModels>[0];
type Recommendation = ReturnType<typeof recommendModels>["recommendations"][number];
type Message = { role: "user" | "assistant"; content: string; fallback?: boolean };
const initialAnswers: Answers = { task: "general", priority: "balanced", context: "short", input: "text" };
const tasks = [["general", "日常问答", "Everyday tasks"], ["coding", "写代码", "Coding"], ["math", "数学解题", "Math"], ["writing", "写作与编辑", "Writing"], ["creative", "创意构思", "Creativity"], ["reasoning", "复杂分析", "Reasoning"]] as const;
const priorities = [["economy", "尽量省钱", "Lowest cost"], ["balanced", "性价比平衡", "Balanced"], ["quality", "质量优先", "Quality first"], ["speed", "响应优先", "Speed first"]] as const;

export function ModelAdvisor({ catalog }: { catalog: CatalogModel[] }) {
  const { t, locale, href } = useSiteLocale();
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [pricing, setPricing] = useState<SelectionPricing | null>(null);
  const [priceError, setPriceError] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [notice, setNotice] = useState("");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const pendingAttempt = useRef<{ key: string; id: string } | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/pricing", { signal: controller.signal }).then(async response => { if (!response.ok) throw new Error(); return response.json(); }).then(setPricing).catch(() => { if (!controller.signal.aborted) setPriceError(true); });
    return () => { controller.abort(); abort.current?.abort(); };
  }, []);
  useEffect(() => { if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; }, [messages, busy]);
  function recommend() {
    if (!pricing) return;
    const result = recommendModels(answers, selectionModels(catalog, pricing.models), selectionPrices(pricing.models, answers.context === "long" ? 128_000 : 2_000));
    setRecommendations(result.recommendations); setNotice(result.notice[locale]); setSubmitted(true); setError("");
  }
  async function send() {
    const text = message.trim(); if (!text || busy) return;
    setBusy(true); setError(""); setNeedsLogin(false);
    const previous = messages.slice(-4).map(({ role, content }) => ({ role, content: content.slice(0, 500) }));
    const body = { locale, answers, message: text, history: previous };
    const attemptKey = JSON.stringify(body);
    if (pendingAttempt.current?.key !== attemptKey) pendingAttempt.current = { key: attemptKey, id: crypto.randomUUID() };
    const controller = new AbortController(); abort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 35_000);
    try {
      const response = await fetch("/api/model-advisor/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, requestId: pendingAttempt.current.id }), signal: controller.signal });
      const payload = await response.json();
      if (response.status === 401) { setNeedsLogin(true); setError(t("登录后可免费使用 AI 追问；上方问卷无需登录。", "Sign in for free AI follow-up questions. The questionnaire works without an account.")); return; }
      if (!response.ok) throw new Error();
      if (!Array.isArray(payload.recommendations) || typeof payload.reply !== "string") throw new Error();
      pendingAttempt.current = null;
      setRecommendations(payload.recommendations); setNotice(typeof payload.notice === "string" ? payload.notice : ""); setSubmitted(true);
      if (isGuidanceAnswers(payload.answers)) setAnswers(payload.answers);
      setMessages(current => [...current, { role: "user" as const, content: text }, { role: "assistant" as const, content: payload.reply, fallback: payload.status !== "ai" }].slice(-12));
      setMessage(""); setRemaining(typeof payload.remainingToday === "number" ? payload.remainingToday : null);
    } catch { setError(t("这次对话未完成，请先用问卷获取推荐。补充内容已保留。", "This conversation could not finish. Use the questionnaire for recommendations; your message has been kept.")); }
    finally { clearTimeout(timeout); if (abort.current === controller) abort.current = null; setBusy(false); }
  }
  return <div className="advisor-layout">
    <section className="advisor-questionnaire" aria-labelledby="advisor-questionnaire-title"><div className="selection-step">01 / {t("说说你的任务", "YOUR TASK")}</div><h2 id="advisor-questionnaire-title">{t("先回答 4 个小问题", "Four questions to get started")}</h2><p>{t("先得到候选，再用真实任务试用。问卷推荐无需登录。", "Get a shortlist, then try it on a real task. No sign-in is needed for the questionnaire.")}</p>
      <fieldset disabled={busy}><legend>{t("你主要用来做什么？", "What are you working on?")}</legend><div className="advisor-options">{tasks.map(([value, zh, en]) => <label key={value}><input type="radio" name="task" value={value} checked={answers.task === value} onChange={() => { setAnswers({ ...answers, task: value }); setSubmitted(false); }} /><span>{t(zh, en)}</span></label>)}</div></fieldset>
      <fieldset disabled={busy}><legend>{t("你最看重什么？", "What matters most?")}</legend><div className="advisor-options">{priorities.map(([value, zh, en]) => <label key={value}><input type="radio" name="priority" checked={answers.priority === value} onChange={() => { setAnswers({ ...answers, priority: value }); setSubmitted(false); }} /><span>{t(zh, en)}</span></label>)}</div></fieldset>
      <fieldset disabled={busy}><legend>{t("材料有多长？", "How much context?")}</legend><select aria-label={t("材料长度", "Context length")} value={answers.context} onChange={event => { setAnswers({ ...answers, context: event.target.value as Answers["context"] }); setSubmitted(false); }}><option value="short">{t("短对话、文章或代码片段", "Short conversations, articles or code")}</option><option value="long">{t("长材料（128K 输入 + 1K 输出）", "Long material (128K input + 1K output)")}</option></select></fieldset>
      <fieldset disabled={busy}><legend>{t("输入包含图片吗？", "Do you need image input?")}</legend><select aria-label={t("输入类型", "Input type")} value={answers.input} onChange={event => { setAnswers({ ...answers, input: event.target.value as Answers["input"] }); setSubmitted(false); }}><option value="text">{t("只输入文字", "Text only")}</option><option value="image" disabled>{t("图片理解（站内暂未开放）", "Image understanding (not yet enabled)")}</option></select></fieldset>
      <button className="button button-primary" type="button" disabled={busy || !pricing} onClick={recommend}>{!pricing && !priceError ? t("正在读取可用模型…", "Loading available models…") : t("查看我的推荐 →", "Show my shortlist →")}</button>{priceError ? <p role="alert">{t("实时价格暂不可用，请刷新后再推荐。", "Live prices are unavailable. Please refresh before generating recommendations.")}</p> : null}
    </section>
    <div className="advisor-main"><section className="advisor-chat" aria-labelledby="advisor-chat-title"><div className="advisor-chat-header"><div><span className="selection-step">02 / TOKVILO ADVISOR</span><h2 id="advisor-chat-title">{t("把具体要求告诉我", "Tell me a little more")}</h2></div><span className="advisor-free">{t("免费选型咨询", "Free model guidance")}</span></div><div className="advisor-transcript" ref={transcript} role="log" aria-live="polite" aria-label={t("选型对话", "Model selection chat")}><div className="advisor-bubble assistant"><strong>tokvilo</strong><p>{t("比如：“我想做中文营销文案，预算低，偶尔需要改代码。”我会结合问卷理解你的偏好，更新下方的模型建议。", "Try: “I need marketing copy on a small budget and occasionally edit code.” I’ll use your questionnaire and follow-up details to refine the shortlist below.")}</p></div>{messages.map((item, index) => <div className={`advisor-bubble ${item.role}`} key={index}><strong>{item.role === "user" ? t("你", "You") : "tokvilo"}</strong><p>{item.content}</p>{item.fallback ? <small>{t("本次使用问卷规则建议，AI 对话暂不可用。", "Questionnaire guidance was used because AI chat was unavailable.")}</small> : null}</div>)}{busy ? <div className="advisor-bubble assistant" role="status">{t("正在理解你的需求…", "Understanding your requirements…")}</div> : null}</div><form onSubmit={event => { event.preventDefault(); void send(); }}><label htmlFor="advisor-message" className="sr-only">{t("补充你的需求", "Add your requirements")}</label><textarea id="advisor-message" value={message} maxLength={800} disabled={busy} onChange={event => setMessage(event.target.value)} placeholder={t("补充用途、语言、预算、期望结果…", "Add your task, language, budget or expected result…")} rows={3} /><div className="advisor-compose-footer"><small>{t("登录后可追问 · 不扣 API 积分", "Sign in to chat · No API credit charge")}{remaining !== null ? t(` · 今日剩余 ${remaining} 次（UTC）`, ` · ${remaining} requests left today (UTC)`) : ""}</small><button className="button button-primary" type="submit" disabled={busy || !message.trim()}>{busy ? t("处理中…", "Working…") : t("发送 →", "Send →")}</button></div></form>{error ? <p className="advisor-error" role="alert">{error} {needsLogin ? <Link href={href(`/login?next=${encodeURIComponent(href("/advisor"))}`)}>{t("登录 / 注册 →", "Sign in / register →")}</Link> : null}</p> : null}</section>
      <section className="advisor-results" aria-labelledby="advisor-results-title"><div className="advisor-results-header"><div><span className="selection-step">03 / {t("你的候选", "YOUR SHORTLIST")}</span><h2 id="advisor-results-title">{t("先试这几款", "A good place to start")}</h2></div><Link href={href("/compare")}>{t("打开完整比较 →", "Full comparison →")}</Link></div>{!submitted ? <p>{t("完成左侧问卷，或发送一条补充需求，即可获得建议。", "Complete the questionnaire or send a follow-up to get a shortlist.")}</p> : <>{notice ? <p className="selection-method">{notice}</p> : null}{!recommendations.length ? <div className="selection-empty">{t("目前没有同时满足这些条件、且平台能力已确认的模型。可以放宽输入或上下文要求，或浏览模型目录。", "No model currently meets all these requirements with confirmed platform support. Try relaxing input or context requirements, or browse the catalogue.")}<Link href={href("/models")}>{t("浏览模型 →", "Browse models →")}</Link></div> : recommendations.map((recommendation, index) => {
        const candidate = recommendation.model;
        const model = catalog.find(item => item.id === candidate.id && publicService(item.upstream) === candidate.service);
        const price = selectionPrices(pricing?.models || [], answers.context === "long" ? 128_000 : 2_000).find(item => item.modelId === candidate.id && item.service === candidate.service);
        const executionModel = model || { id: candidate.id, category: "text" as const, upstream: candidate.service === "studio" ? "tokenhub" as const : candidate.service === "selected" ? "selected" as const : "apimart" as const };
        return <article className="advisor-result" key={`${candidate.service}:${candidate.id}`}><div className="advisor-result-heading"><ProviderLogo provider={candidate.provider} size={28} /><div><span>{t(`候选 ${index + 1}`, `Option ${index + 1}`)}</span><h3>{candidate.id}</h3></div></div><ul>{recommendation.reasons.map((reason, n) => <li key={n}>{reason[locale]}</li>)}</ul>{recommendation.tradeoffs.map((tradeoff, n) => <p className="advisor-tradeoff" key={n}>{tradeoff[locale]}</p>)}{price ? <div className="advisor-rate-pair"><small>{t(`${CREDIT_EXCHANGE_LABEL.zh}`, `${CREDIT_EXCHANGE_LABEL.en}`)}</small>{([["input", price.inputUsdPerMillion], ["output", price.outputUsdPerMillion]] as const).map(([dimension, value]) => <span key={dimension}>{dimension === "input" ? t("输入", "Input") : t("输出", "Output")}: {formatCreditsWithUsd(Math.round(value * 1_000_000), locale)} / 1M tokens</span>)}</div> : null}<div className="advisor-result-actions"><Link href={href(`/compare?models=${encodeURIComponent(`${candidate.service}:${candidate.id}`)}`)}>{t("比较能力与官方价格", "Compare capabilities & official price")}</Link><Link className="button button-secondary" href={href(modelWorkbenchUrl(executionModel))}>{t("去试用 ↗", "Try in Playground ↗")}</Link></div></article>;
      })}</>}</section>
    </div>
  </div>;
}
