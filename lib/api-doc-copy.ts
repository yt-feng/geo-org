import type { ApiOperation } from "./api-documentation";

/** Presentation-only translation. Never translate example payloads, model IDs or schema constraints. */
const copy: Record<string, string> = {
  "tokvilo 生成 API": "tokvilo Generation API",
  "使用当前账户的 tokvilo API Key。调用前预留钱包余额，完成后按公布的 tokvilo 售价结算并退回差额。金额单位为 micro-USD（1 USD = 1,000,000 micro-USD）。": "Use a tokvilo API key from your account. Wallet funds are reserved before each request; completed requests are settled at the published tokvilo rates and any excess is returned. Amounts use micro-USD (1 USD = 1,000,000 micro-USD).",
  "查询 tokvilo 模型服务 模型与实时价格": "List tokvilo Models and current prices",
  "tokvilo 模型服务 · 模型": "tokvilo Models · Models",
  "返回上游密钥可访问的模型与 tokvilo 报价。pricing 为 null 的模型尚未开通付费调用。公开价格目录为 GET /api/pricing。": "Returns models available through the configured service credential and their tokvilo prices. Models with pricing=null are not enabled for paid requests. The public price catalogue is GET /api/pricing.",
  "模型目录，包含 pricing 和 pricing_observed_at。": "Model catalogue, including pricing and pricing_observed_at.",
  "请求参数无效。": "Invalid request parameters.",
  "请登录或提供有效 API Key。": "Sign in or provide a valid API key.",
  "钱包余额不足。": "Insufficient wallet balance.",
  "账户已停用或浏览器请求不是同源请求。": "The account is disabled or the browser request is not same-origin.",
  "请求编号冲突，或之前的请求结果等待确认。": "Request ID conflict, or the previous request is awaiting confirmation.",
  "模型或参数尚无可用报价。": "No supported quote is available for this model or its parameters.",
  "请求限流。": "Request rate limit reached.",
  "上游结果或用量尚未确认，保留原请求编号。": "The result or usage has not been confirmed. Retain the original request ID.",
  "服务、密钥或实时价格暂不可用。": "The service, credential or current pricing is temporarily unavailable.",
  "tokvilo 模型服务 文本对话": "tokvilo Models text chat",
  "tokvilo 模型服务 · 文本": "tokvilo Models · Text",
  "每次新请求使用唯一编号；重试保持相同编号与内容，不会再次发起同一付费请求。": "Use a unique ID for each new request. Keep the same ID and contents when retrying so the same paid request is not sent again.",
  "可使用工作台报价返回的预留金额作为上限。最新金额超过此上限时返回 409，且不会预留余额或创建付费请求。": "Use the reservation returned by the workspace quote as a maximum. If the latest amount exceeds this limit, the request returns 409 without reserving funds or creating a paid request.",
  "支持 billingReady=true 的纯文本对话模型，包含已适配的缓存、分档与时段价格。stream 必须为 false；暂不支持工具与多模态输入。max_tokens（或兼容别名 max_completion_tokens）只能选一个，范围 1–4096，默认 1024。费用依据返回 usage；缓存写入需匹配 TTL 用量，跨计价时段或用量不完整时保留预留并等待核对。": "Supports plain-text chat models with billingReady=true, including supported cache, tier and time-based pricing. stream must be false; tools and multimodal input are not supported. Specify only one of max_tokens or its compatible alias max_completion_tokens, in the range 1–4096; the default is 1024. Billing uses the returned usage. Cache writes require matching TTL usage. Requests spanning pricing periods or returning incomplete usage retain their reservation pending reconciliation.",
  "上游 JSON 和 tokvilo_billing；status=settled 时 chargedMicrousd 为最终费用，awaiting_reconciliation 表示尚待核对。": "Model JSON and tokvilo_billing. When status=settled, chargedMicrousd is the final charge; awaiting_reconciliation means billing still needs reconciliation.",
  "创建 tokvilo 生成任务": "Create a tokvilo generation task",
  "tokvilo 模型服务 · 图片": "tokvilo Models · Images",
  "支持 billingReady=true 的图片模型。通常每次生成一张图片；Midjourney 每次创建一个 Imagine 任务，结果可包含四宫格及裁切图，按任务次数计价，默认 version=7、speed=relax。固定价格根据 resolution、version、speed 或 quality 组合报价，参考图费用在已公布时计入预留。未核定的参数会在扣费前拒绝；自定义像素尺寸暂未开放。请求成功只表示任务受理，使用返回的 data[0].task_id 查询。完成后返回 tokvilo_billing 中的最终费用，失败任务退回预留。后台会自动查询已创建任务，无需一直打开工作台。": "Supports image models with billingReady=true. Most requests generate one image. Midjourney creates one Imagine task, which may return a four-image grid and cropped images; billing is per task, with defaults version=7 and speed=relax. Fixed prices depend on the resolution, version, speed or quality combination. Published reference-image charges are included in the reservation. Unsupported parameters are rejected before any debit; custom pixel dimensions are not available. A successful response means the task was accepted, not completed. Query the returned data[0].task_id. Completion returns the final charge in tokvilo_billing; failed tasks release the reservation. Created tasks are checked automatically in the background, so the workspace need not remain open.",
  "按模型选择：flare/sunburst，或 Midjourney 的 5.1/5.2/6.1/7/8.1/8.2；niji=true 时为 6 或 7。": "Choose by model: flare/sunburst, or Midjourney 5.1/5.2/6.1/7/8.1/8.2. When niji=true, use 6 or 7.",
  "仅 Midjourney，启用动漫模型。": "Midjourney only: enables the anime model.",
  "仅 Midjourney。": "Midjourney only.",
  "任务编号与预留金额。": "Task ID and reserved amount.",
  "创建 tokvilo 视频任务": "Create a tokvilo video task",
  "tokvilo · 视频": "tokvilo · Video",
  "仅支持价格目录 billingReady=true 的已适配模型与参数。必须明确填写 duration；按模型选择 resolution 或 mode。不同模型的时长、分辨率和音轨限制不同，报价与生成使用相同校验。wan2.7-r2v 支持 1–5 张参考图、2–15 秒、720P/1080P；image_with_roles 使用 reference_image 或单个 first_frame，也可用 image_urls 自动转换为 reference_image。参考视频、音频素材、编辑、续写、动作迁移与自动时长尚未开放。提交后使用统一任务接口查询；失败退回预留，未知结果保留预留。": "Supports only adapted models and parameters marked billingReady=true in the price catalogue. Specify duration explicitly; choose resolution or mode according to the model. Duration, resolution and audio limits vary by model; quoting and generation apply the same validation. wan2.7-r2v supports 1–5 reference images, 2–15 seconds and 720P/1080P. image_with_roles accepts reference_image or a single first_frame; image_urls can also be converted automatically to reference_image. Reference video, audio inputs, editing, continuation, motion transfer and automatic duration are not available. Query submitted tasks through the common task endpoint. Failed tasks release their reservation; unknown outcomes retain it.",
  "wan2.7-r2v 的图片参考模式；最多一张 first_frame，其余为 reference_image，省略 role 时默认 reference_image。其他支持首尾帧的型号按各自限制使用 first_frame/last_frame。": "Image-reference mode for wan2.7-r2v. At most one image may use first_frame; the others use reference_image, which is also the default when role is omitted. Other models supporting first/last frames use first_frame/last_frame within their own limits.",
  "data[0].task_id 为已受理任务编号，tokvilo_billing 为余额预留。": "data[0].task_id identifies the accepted task; tokvilo_billing describes the wallet reservation.",
  "创建 tokvilo 音乐任务": "Create a tokvilo music task",
  "tokvilo · 音乐": "tokvilo · Music",
  "Suno 仅支持 v6、v6-mini、v6-wild；custom=false 时 prompt 为音乐描述，自定义模式可填写歌词或 instrumental=true。max_mode 需要 custom=true，并会改变本次报价。Flow Music 使用 sound_prompt 或 lyrics（至少一个）。私有训练模型、翻唱、延长、分轨、上传与其他音乐动作尚未开放。": "Suno supports only v6, v6-mini and v6-wild. With custom=false, prompt describes the music; custom mode accepts lyrics or instrumental=true. max_mode requires custom=true and changes the quote. Flow Music uses sound_prompt or lyrics (at least one is required). Private trained models, covers, extension, stem separation, uploads and other music actions are not available.",
  "音乐任务编号；用统一任务接口查询 data.result.music 中的音频结果。": "Music task ID. Query the common task endpoint for audio results in data.result.music.",
  "查询当前账户的音乐任务": "Query a music task belonging to this account",
  "与统一任务查询等价；只允许查询本站创建且属于当前账户的任务。": "Equivalent to the common task query. Only tasks created on this site and owned by the current account can be queried.",
  "音乐任务状态、结果和结算。": "Music task status, results and billing.",
  "列出当前账户的 tokvilo 生成任务": "List this account’s tokvilo generation tasks",
  "返回当前账户在本站创建的最近 50 个任务。任务列表不会创建生成请求。": "Returns the latest 50 tasks created on this site by the current account. Listing tasks does not create generation requests.",
  "任务 ID、模型、状态和时间。": "Task IDs, models, statuses and timestamps.",
  "查询 tokvilo 生成结果": "Query a tokvilo generation result",
  "只允许查询属于当前账户的任务。completed 后查看 data.result.images、videos 或 music 和 tokvilo_billing；媒体 URL 可能有过期时间。重复查询不会重复扣款。": "Only tasks belonging to the current account may be queried. After completed, read data.result.images, videos or music and tokvilo_billing. Media URLs may expire. Repeated queries do not incur duplicate charges.",
  "任务状态、结果与最终结算。": "Task status, results and final billing.",
  "此账户没有对应任务。": "No matching task belongs to this account.",
  "tokvilo 多模态 API": "tokvilo Multimodal API",
  "tokvilo 多模态 文档独立于数据接口目录。文本返回完整 JSON，当前不支持流式返回。": "tokvilo Multimodal documentation is separate from the Data API catalogue. Text responses return complete JSON; streaming is not supported.",
  "使用当前账户的 tokvilo API Key（tk_live_ 前缀，兼容旧 eco_live_）。会员按公布的 tokvilo 售价从余额结算；浏览器写操作要求同源 Origin。": "Use a tokvilo API key from the current account (tk_live_ prefix; legacy eco_live_ keys are also accepted). Usage is settled from the account balance at the published tokvilo rates. Browser write requests require a same-origin Origin header.",
  "获取 tokvilo 多模态 全模型目录": "Get the complete tokvilo Multimodal catalogue",
  "tokvilo 多模态 · 模型": "tokvilo Multimodal · Models",
  "完整或明确标注的部分目录。": "A complete catalogue, or an explicitly marked partial catalogue.",
  "请求参数不合法。": "Invalid request parameters.",
  "tokvilo API Key 无效或登录已过期。": "The tokvilo API key is invalid or the login session has expired.",
  "账户余额不足。": "Insufficient account balance.",
  "账户已停用，或浏览器写操作不是同源请求。": "The account is disabled or the browser write request is not same-origin.",
  "请求限流，请按返回提示等待。": "Request rate limit reached. Wait as instructed by the response.",
  "上游未完整返回；收费请求结果可能待确认，不要盲目重复提交。": "The model service returned an incomplete response. A paid request may still be awaiting confirmation; check it before resubmitting.",
  "服务或上游配置当前不可用。": "The service or its configured connection is currently unavailable.",
  "每次新请求使用新编号，同一请求重试保持相同编号与请求体。": "Use a new ID for each new request. Retain the same ID and request body when retrying.",
  "tokvilo 多模态 文本对话": "tokvilo Multimodal text chat",
  "tokvilo 多模态 · 文本": "tokvilo Multimodal · Text",
  "stream 必须为 false。OpenAI 兼容客户端的文本 base_url 为 __TOKVILO_BASE_URL__。超时后先核对上游调用记录；会员所有生成请求必须提供 Idempotency-Key，重试沿用同一编号。": "stream must be false. For OpenAI-compatible text clients, use base_url=__TOKVILO_BASE_URL__. After a timeout, check the request records first. All member generation requests require Idempotency-Key; retain the same ID for retries.",
  "输出上限。思考模型的推理也可能消耗输出额度，具体上限以所选模型为准。": "Output limit. Reasoning tokens may also consume the output allowance; the exact limits depend on the selected model.",
  "对话结果与 usage，包含模型返回的推理字段（如有）。": "Chat result and usage, including reasoning fields when returned by the model.",
  "tokvilo 多模态 图片生成": "tokvilo Multimodal image generation",
  "tokvilo 多模态 · 图片": "tokvilo Multimodal · Images",
  "使用图片专属 v3 路径。以下为最小文字生成图片示例；未添加当前模型不支持的 sequential_image_generation 参数。图片和文本超时后均须先核对调用记录。": "Use the image-specific v3 endpoint. This is a minimal text-to-image example; sequential_image_generation is omitted because the current model does not support it. After an image or text timeout, check the request records first.",
  "示例使用 2K；其他尺寸以所选模型的支持范围为准。": "The example uses 2K. Other sizes depend on the selected model’s supported range.",
  "图片 URL 与返回元数据。": "Image URLs and returned metadata.",
  "列出当前账户的 tokvilo 多模态 视频任务": "List this account’s tokvilo Multimodal video tasks",
  "tokvilo 多模态 · 视频": "tokvilo Multimodal · Video",
  "返回当前 tokvilo 账户在本站创建的最近 50 个任务；这是本地任务记录，不会创建视频，也不接受查询参数。实时状态通过任务详情接口读取。": "Returns the latest 50 tasks created on this site by the current tokvilo account. These are local task records; this endpoint does not create videos and accepts no query parameters. Query the task detail endpoint for live status.",
  "当前账户的本地任务列表。": "The current account’s local task list.",
  "创建 tokvilo 多模态 视频任务": "Create a tokvilo Multimodal video task",
  "创建后保存返回 id，通过同一账户查询。每次新任务使用新的 Idempotency-Key；同一次提交重试必须沿用同一编号和完全相同的请求体。结果未知时会返回 409，不能通过更换编号来重复生成。": "Save the returned id after creation and query it using the same account. Use a new Idempotency-Key for each new task. Retries of the same submission must retain both the ID and the exact request body. Unknown outcomes return 409; do not change the ID to generate the same request again.",
  "新任务使用新的 8–128 位字母、数字、下划线或连字符；同一任务重试保持不变。": "Use a new 8–128 character ID containing letters, numbers, underscores or hyphens for each new task. Keep it unchanged for retries.",
  "4–15 秒，或 -1 由上游选择；所选模型可能有更窄的支持范围。": "4–15 seconds, or -1 for the model service to choose. The selected model may support a narrower range.",
  "任务已受理，保存返回的 id；不代表视频已经生成完毕。": "Task accepted. Save the returned id; acceptance does not mean the video has finished generating.",
  "任务已创建，保存返回的 id。": "Task created. Save the returned id.",
  "同一编号的请求体不一致，或此前提交结果尚未确认。": "The request body differs for the same ID, or the earlier submission has not been confirmed.",
  "查询 tokvilo 多模态 视频任务": "Query a tokvilo Multimodal video task",
  "只允许查询当前 tokvilo 账户在本站创建的任务。返回 status；仅在生成成功后读取视频 URL。": "Only tasks created on this site by the current tokvilo account can be queried. Returns status; read the video URL only after generation succeeds.",
  "创建任务接口返回的 id。": "The id returned by the task creation endpoint.",
  "上游实时任务状态及媒体结果（如已完成）。": "Live task status from the model service, including media results if completed.",
  "当前账户没有该任务。": "This task does not belong to the current account.",
  "取消或删除 tokvilo 多模态 视频任务": "Cancel or delete a tokvilo Multimodal video task",
  "只允许操作当前账户在本站创建的任务。能否取消由任务状态及上游决定；取消或删除不等于已退费。": "Only tasks created on this site by the current account may be changed. Whether cancellation is possible depends on the task state and model service. Cancellation or deletion does not establish that a refund has been made.",
  "返回取消／删除结果；上游空 204 被规范为 JSON 状态 cancelled_or_deleted。": "Returns the cancellation/deletion result. An empty 204 response from the model service is normalized to JSON with status cancelled_or_deleted.",
  "tokvilo 精选 API": "tokvilo Select API",
  "使用 tokvilo API Key 与账户余额调用精选模型。模型 ID 与其他服务可能相同，请使用本服务地址；仅 billingReady=true 的模型可调用。价格目录为 /api/pricing 中 provider=selected 的条目。": "Use a tokvilo API key and your account balance to call Select models. Model IDs may overlap with other services, so use this service’s endpoint. Only models with billingReady=true can be called. Their prices are the provider=selected entries in /api/pricing.",
  "tokvilo 精选文本对话": "tokvilo Select text chat",
  "tokvilo 精选 · 文本": "tokvilo Select · Text",
  "每次新请求使用唯一编号。内容相同的重试沿用原编号，避免重复提交。": "Use a unique ID for each new request. Retain the original ID when retrying identical contents to avoid duplicate submissions.",
  "本次允许的最大预留金额，可填写工作台报价返回的 reservedMicrousd；1 美元等于 1000000 micro-USD。": "The maximum reservation allowed for this request. Use reservedMicrousd from the workspace quote if desired. 1 USD equals 1000000 micro-USD.",
  "支持纯文本完整响应。每次只返回一个结果，stream 必须为 false。消息最多 100 条，总内容不超过 32 KB。必须指定 max_tokens 或 max_completion_tokens（只能选一个），范围 1–4096。工具调用、多模态输入和流式响应暂未开放。先预留余额，再按返回的实际用量结算并退回差额。": "Supports complete plain-text responses, with one result per request and stream=false. At most 100 messages and 32 KB of combined content are allowed. Specify exactly one of max_tokens or max_completion_tokens, in the range 1–4096. Tool calls, multimodal input and streaming responses are not available. Funds are reserved first, then settled using the returned actual usage; any excess is returned.",
  "生成结果、实际用量与 tokvilo_billing。status=settled 表示已结算；等待核对时请保留原请求编号。": "Generation result, actual usage and tokvilo_billing. status=settled means billing is complete. Retain the original request ID while reconciliation is pending.",
  "请登录或使用有效的 tokvilo API Key。": "Sign in or use a valid tokvilo API key.",
  "余额不足。": "Insufficient balance.",
  "请求编号冲突或最新报价超过确认上限。": "Request ID conflict, or the latest quote exceeds the confirmed limit.",
  "模型尚未适配此接口。": "This model is not adapted to this endpoint.",
  "请求过于频繁。": "Too many requests.",
  "结果或用量尚待核对，请保留原请求编号。": "Results or usage await reconciliation. Retain the original request ID.",
  "该模型服务暂未开通或报价暂不可用。": "This model service is not enabled, or its quote is temporarily unavailable.",
  "tokvilo 精选图片生成": "tokvilo Select image generation",
  "tokvilo 精选 · 图像": "tokvilo Select · Images",
  "当前适配 gpt-image-2：每次生成 1 张 1024x1024 图像，结果仅支持 HTTPS 图片链接（response_format=url）。该模型仍需在价格目录中显示 billingReady=true 才能调用。其他图片型号可查看价格，接口开通状态独立显示。": "Currently supports gpt-image-2: one 1024x1024 image per request, returned only as an HTTPS image URL (response_format=url). The model must also be marked billingReady=true in the price catalogue before it can be called. Prices for other image models remain visible, with endpoint availability shown separately."
};
const entries = Object.entries(copy).sort((a, b) => b[0].length - a[0].length);

export function englishApiDocText(value: string): string {
  let text = value;
  const baseUrl = text.match(/OpenAI 兼容客户端的文本 base_url 为 ([^\s。]+)。/)?.[1];
  if (baseUrl) text = text.replace(baseUrl, "__TOKVILO_BASE_URL__");
  text = text.replace(/以下枚举是 ([0-9-]+) 的模型参考。完整实时目录通过 GET (\S+) 获取；新增模型以目录返回的 endpoint 和 integrationStatus 为准。目录在列不等于账户已获该模型调用权限。/g,
    (_, date: string, endpoint: string) => `The enumeration below is the model reference dated ${date}. Get the complete live catalogue using GET ${endpoint}. For new models, follow the endpoint and integrationStatus returned by the catalogue. A listing does not establish that your account has permission to call that model.`)
    .replace(/合并模型接口与价格市场，包含文本、图片和视频。检查 catalog.complete、各来源状态以及 data\[\]\.integrationStatus、endpoint、accountAccess；价格来源失败时返回明确的部分目录，不伪装成完整清单。当前参考共 (\d+) 个模型，新模型也会出现在此目录。/g,
      (_, count: string) => `Combines the model endpoint and price market, including text, images and video. Check catalog.complete, the source statuses, and data[].integrationStatus, endpoint and accountAccess. If a pricing source fails, the result is explicitly identified as a partial catalogue. The current reference includes ${count} models; newly discovered models also appear here.`);
  for (const [zh, en] of entries) text = text.replaceAll(zh, en);
  return baseUrl ? text.replaceAll("__TOKVILO_BASE_URL__", baseUrl) : text;
}

const literalKeys = new Set(["example", "examples", "enum", "default", "const", "$ref", "required"]);
const textKeys = new Set(["summary", "description", "title"]);
/** Clone descriptive schema fields while preserving executable examples and validation data byte for byte. */
export function englishApiSchemaCopy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(englishApiSchemaCopy);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => {
    if (literalKeys.has(key)) return [key, child];
    if (textKeys.has(key) && typeof child === "string") return [key, englishApiDocText(child)];
    if (key === "tags" && Array.isArray(child)) return [key, child.map(tag => typeof tag === "string" ? englishApiDocText(tag) : tag && typeof tag === "object" ? { ...tag, ...(typeof tag.name === "string" ? { name: englishApiDocText(tag.name) } : {}) } : tag)];
    return [key, englishApiSchemaCopy(child)];
  }));
}

export function englishApiOperation(operation: ApiOperation): ApiOperation {
  // Third-party data API documentation may contain arbitrary source text.
  if (operation.source === "tikhub") return operation;
  return englishApiSchemaCopy(operation) as ApiOperation;
}
