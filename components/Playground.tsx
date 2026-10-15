"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import { modelCatalog, modelCategories, providerInitials, type ModelCategory } from "@/lib/model-catalog";

const endpoints: Record<ModelCategory, string> = { image: "/v1/images/generations", video: "/v1/videos/generations", text: "/v1/chat/completions", audio: "/v1/music/generations" };
const prompts: Record<ModelCategory, string> = { image: "描述你想创建的画面、风格、光线和构图...", video: "描述场景、主体动作与镜头运动...", text: "输入消息，构建你的对话请求...", audio: "描述音乐的氛围、乐器与节奏..." };
const examples: Record<ModelCategory, string[]> = { image: ["清晨薄雾中的山间小屋，柔和自然光，电影摄影质感。", "极简风格产品摄影，银色耳机置于浅灰色石材上，细腻阴影。", "蓝白配色的未来城市，等距视角，干净的几何线条。"], video: ["航拍镜头缓缓掠过海岸线，晨光照亮波浪，电影感。", "镜头向前推进，穿过一座安静花园，树叶在微风中摇动。"], text: ["请将以下想法整理成清晰的产品介绍：一个统一管理多种 API 的开发者平台。", "帮我写一个 Python 示例，读取 JSON 文件并汇总每种类别的数量。"], audio: ["轻柔的 lo-fi 钢琴，雨声背景，适合深夜专注工作的氛围。", "温暖明亮的原声吉他旋律，轻快的节奏，没有人声。"] };

function shellQuote(value: string) { return `'${value.replaceAll("'", "'\\''")}'`; }

export function Playground({ initialModel, initialCategory, isAdmin }: { initialModel?: string; initialCategory?: string; isAdmin: boolean }) {
  const firstCategory = modelCategories.some(item => item.id === initialCategory) ? initialCategory as ModelCategory : modelCatalog.find(item => item.id === initialModel)?.category || "image";
  const [category, setCategory] = useState<ModelCategory>(firstCategory);
  const [model, setModel] = useState(initialModel || modelCatalog.find(item => item.category === firstCategory)?.id || "gpt-image-2");
  const [prompt, setPrompt] = useState("");
  const [resolution, setResolution] = useState("2k");
  const [ratio, setRatio] = useState("1:1");
  const [reference, setReference] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [format, setFormat] = useState<"json" | "curl">("json");
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [promptExample, setPromptExample] = useState(0);
  const selected = modelCatalog.find(item => item.id === model);
  const detailedImage = category === "image" && model === "gpt-image-2";
  const payload = category === "text" ? { model, messages: [{ role: "user", content: prompt }], stream: false } : category === "audio" ? { model, custom: false, version: "v6", prompt, instrumental } : detailedImage ? { model, prompt, n: 1, size: ratio, resolution, ...(reference.trim() ? { image_urls: [reference.trim()] } : {}) } : { model, prompt };
  const json = JSON.stringify(payload, null, 2);
  const curl = `curl --request POST \\\n  --url 'https://api.apimart.ai${endpoints[category]}' \\\n  --header 'Authorization: Bearer YOUR_APIMART_API_KEY' \\\n  --header 'Content-Type: application/json' \\\n  --data ${shellQuote(json)}`;
  function changeCategory(value: ModelCategory) { setCategory(value); setModel(modelCatalog.find(item => item.category === value)?.id || ""); setShowPreview(false); setCopied(false); setPromptExample(0); }
  async function copy() { try { await navigator.clipboard.writeText(format === "json" ? json : curl); setCopied(true); setCopyError(false); setTimeout(() => setCopied(false), 1800); } catch { setCopyError(true); } }

  return <div className="playground-layout">
    <section className="playground-controls" aria-label="请求参数">
      <div className="playground-control-header"><span>PLAYGROUND</span><Link href="/models" aria-label="查看模型市场"><Icon name="store" size={17} /></Link></div>
      <div className="playground-category-tabs" role="tablist" aria-label="生成类型">{modelCategories.map(item => <button key={item.id} role="tab" type="button" aria-selected={category === item.id} className={category === item.id ? "selected" : ""} onClick={() => changeCategory(item.id)}><Icon name={item.icon} size={15} />{item.label}</button>)}</div>
      <div className="playground-form-fields">
        <label className="playground-field"><span>模型 <span className="field-required">*</span></span><div className="playground-model-select"><span className="playground-model-mark">{providerInitials(selected?.provider || "M")}</span><select aria-label="选择模型" value={selected?.id || "custom"} onChange={event => { setModel(event.target.value === "custom" ? "" : event.target.value); setShowPreview(false); }}>{modelCatalog.filter(item => item.category === category).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="custom">自定义模型</option></select></div></label>
        <label className="playground-field playground-model-id"><span>Model ID</span><input value={model} onChange={event => setModel(event.target.value)} placeholder="填写上游提供的模型 ID" spellCheck={false} /><small>可按上游模型列表修改</small></label>
        <label className="playground-field"><span>提示词 <span className="field-required">*</span><button type="button" aria-label="插入提示词示例" onClick={() => { setPrompt(examples[category][promptExample % examples[category].length]); setPromptExample(promptExample + 1); }}><Icon name="sparkles" size={13} />试试示例</button></span><textarea aria-label="提示词" value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={prompts[category]} rows={6} maxLength={10000} /><small className="prompt-character-count">{prompt.length.toLocaleString()} / 10,000</small></label>
        {detailedImage ? <>
          <fieldset className="playground-field"><legend>分辨率</legend><div className="playground-option-row">{["1k", "2k", "4k"].map(value => <button key={value} type="button" className={resolution === value ? "selected" : ""} aria-pressed={resolution === value} onClick={() => setResolution(value)}>{value.toUpperCase()}</button>)}</div></fieldset>
          <label className="playground-field"><span>图片比例</span><select value={ratio} onChange={event => setRatio(event.target.value)} aria-label="图片比例">{["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "auto"].map(value => <option key={value} value={value}>{value === "auto" ? "自动" : value}</option>)}</select></label>
          <div className="playground-field"><span>生成数量</span><div className="playground-fixed-value">1 张 <span>单次请求</span></div></div>
          <label className="playground-field"><span>参考图 <small>选填</small></span><div className="playground-reference"><Icon name="image" size={20} /><input type="url" value={reference} onChange={event => setReference(event.target.value)} placeholder="粘贴公开图片 URL" aria-label="参考图片 URL" /></div></label>
        </> : null}
        {category === "audio" ? <label className="playground-check"><input type="checkbox" checked={instrumental} onChange={event => setInstrumental(event.target.checked)} />纯音乐，无人声</label> : null}
        {category === "video" || (category === "image" && !detailedImage) || category === "text" ? <div className="playground-parameter-note"><Icon name="info" size={15} /><p>这里提供基础请求。其他选项请按所选模型的参数文档补充。</p></div> : null}
      </div>
      <div className="playground-run-area"><button className="playground-run" type="button" disabled={!model.trim() || !prompt.trim()} onClick={() => { setShowPreview(true); setCopied(false); }}><Icon name="code" size={17} />生成请求预览<Icon name="arrow-right" size={17} /></button><span><i />本地构建 · 不消耗额度</span></div>
    </section>
    <section className="playground-workspace" aria-label="请求工作台">
      <header className="playground-workspace-header"><div><h1>请求工作台</h1><span>从一个想法开始</span></div><a href={selected?.docs || "https://docs.apimart.ai"} target="_blank" rel="noreferrer"><Icon name="book" size={15} />模型文档<Icon name="arrow-up-right" size={14} /></a></header>
      <div className="playground-notice"><span className="playground-notice-dot" /><p>参数预览已就绪。ECO-GEO 的 APIMart 生成接口尚未启用。</p>{isAdmin ? <Link href="/admin">管理上游 <Icon name="arrow-right" size={13} /></Link> : <Link href="/dashboard/docs">查看已开通 API <Icon name="arrow-right" size={13} /></Link>}</div>
      {showPreview ? <div className="playground-preview-area">
        <div className="playground-preview-meta"><span className="request-method">POST</span><code>{endpoints[category]}</code><span>上游请求示例</span></div>
        <div className="playground-code-panel"><div className="playground-code-toolbar"><div role="tablist" aria-label="代码格式"><button role="tab" aria-selected={format === "json"} type="button" className={format === "json" ? "selected" : ""} onClick={() => setFormat("json")}>JSON</button><button role="tab" aria-selected={format === "curl"} type="button" className={format === "curl" ? "selected" : ""} onClick={() => setFormat("curl")}>cURL</button></div><button type="button" onClick={copy}><Icon name={copied ? "check" : "copy"} size={14} />{copied ? "已复制" : "复制代码"}</button></div><pre tabIndex={0}><code>{format === "json" ? json : curl}</code></pre></div>
        <div className="playground-code-note" role="status">{copyError ? "复制未完成，请选择上方代码后手动复制。" : "此示例指向 APIMart 上游，需要你自己的上游 API Key。模型 ID 与参数请按对应文档确认。"}</div>
        <div className="playground-request-summary"><div><span>模型</span><strong>{selected?.name || model}</strong></div><div><span>能力</span><strong>{modelCategories.find(item => item.id === category)?.label}</strong></div><div><span>执行状态</span><strong>尚未发送</strong></div></div>
      </div> : <div className="playground-empty-state"><div className="playground-empty-art" aria-hidden="true"><span /><span /><span /><Icon name={modelCategories.find(item => item.id === category)?.icon || "image"} size={32} /></div><h2>让想法有一个起点</h2><p>选择模型，填写提示词。<br />在这里预览并复制你的 API 请求。</p><div className="playground-suggestions">{examples[category].slice(0, 2).map((example, i) => <button type="button" key={example} onClick={() => setPrompt(example)}><Icon name={i ? "sparkles" : "image"} size={15} /><span>{example}</span><Icon name="arrow-up-right" size={13} /></button>)}</div></div>}
      <footer className="playground-workspace-footer"><span>ECO-GEO PLAYGROUND</span><span>你的提示词只在当前页面保留</span></footer>
    </section>
  </div>;
}
