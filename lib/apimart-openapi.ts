const BASE = "/api/gateway";
const auth = "使用当前账户的 tokvilo API Key。调用前预留钱包余额，完成后按公布的 tokvilo 售价结算并退回差额。金额单位为 micro-USD（1 USD = 1,000,000 micro-USD）。";
const response = (description: string) => ({ description, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } });
const errors = { "400": response("请求参数无效。"), "401": response("请登录或提供有效 API Key。"), "402": response("钱包余额不足。"), "403": response("账户已停用或浏览器请求不是同源请求。"), "409": response("请求编号冲突，或之前的请求结果等待确认。"), "422": response("模型或参数尚无可用报价。"), "429": response("请求限流。"), "502": response("上游结果或用量尚未确认，保留原请求编号。"), "503": response("服务、密钥或实时价格暂不可用。") };
const idempotency = [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{8,128}$" }, example: "replace_with_unique_request_id", description: "每次新请求使用唯一编号；重试保持相同编号与内容，不会再次发起同一付费请求。" }, { name: "X-Tokvilo-Max-Reserve-Microusd", in: "header", required: false, schema: { type: "integer", minimum: 1, maximum: 1000000000000 }, description: "可使用工作台报价返回的预留金额作为上限。最新金额超过此上限时返回 409，且不会预留余额或创建付费请求。" }];
const body = (schema: unknown, example: unknown) => ({ required: true, content: { "application/json": { schema, example } } });

export function apimartOpenApi(baseUrl: string) {
  return {
    openapi: "3.0.3", info: { title: "tokvilo 生成 API", version: "1.1.0", description: auth },
    servers: [{ url: baseUrl.replace(/\/+$/, "") }], security: [{ TokviloBearer: [] }],
    components: { securitySchemes: { TokviloBearer: { type: "http", scheme: "bearer", bearerFormat: "tokvilo API Key" } } },
    paths: {
      [BASE + "/v1/models"]: { get: { summary: "查询 tokvilo 模型服务 模型与实时价格", tags: ["tokvilo 模型服务 · 模型"], description: "返回上游密钥可访问的模型与 tokvilo 报价。pricing 为 null 的模型尚未开通付费调用。公开价格目录为 GET /api/pricing。", responses: { "200": response("模型目录，包含 pricing 和 pricing_observed_at。"), ...errors } } },
      [BASE + "/v1/chat/completions"]: { post: {
        summary: "tokvilo 模型服务 文本对话", tags: ["tokvilo 模型服务 · 文本"], parameters: idempotency,
        description: `${auth} 支持 billingReady=true 的纯文本对话模型，包含已适配的缓存、分档与时段价格。stream 必须为 false；暂不支持工具与多模态输入。max_tokens（或兼容别名 max_completion_tokens）只能选一个，范围 1–4096，默认 1024。费用依据返回 usage；缓存写入需匹配 TTL 用量，跨计价时段或用量不完整时保留预留并等待核对。`,
        requestBody: body({ type: "object", required: ["model", "messages"], additionalProperties: false, properties: {
          model: { type: "string" }, messages: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", required: ["role", "content"], properties: { role: { type: "string", enum: ["system", "user", "assistant"] }, content: { type: "string" } }, additionalProperties: false } },
          stream: { type: "boolean", enum: [false] }, max_completion_tokens: { type: "integer", minimum: 1, maximum: 4096 }, max_tokens: { type: "integer", minimum: 1, maximum: 4096 }, temperature: { type: "number", minimum: 0, maximum: 2 }, top_p: { type: "number", minimum: 0, maximum: 1 },
        } }, { model: "gpt-5", messages: [{ role: "user", content: "请用一句话介绍自己。" }], stream: false, max_tokens: 1024 }),
        responses: { "200": response("上游 JSON 和 tokvilo_billing；status=settled 时 chargedMicrousd 为最终费用，awaiting_reconciliation 表示尚待核对。"), ...errors },
      } },
      [BASE + "/v1/images/generations"]: { post: {
        summary: "创建 tokvilo 生成任务", tags: ["tokvilo 模型服务 · 图片"], parameters: idempotency,
        description: `${auth} 支持 billingReady=true 的图片模型。通常每次生成一张图片；Midjourney 每次创建一个 Imagine 任务，结果可包含四宫格及裁切图，按任务次数计价，默认 version=7、speed=relax。固定价格根据 resolution、version、speed 或 quality 组合报价，参考图费用在已公布时计入预留。未核定的参数会在扣费前拒绝；自定义像素尺寸暂未开放。请求成功只表示任务受理，使用返回的 data[0].task_id 查询。完成后返回 tokvilo_billing 中的最终费用，失败任务退回预留。后台会自动查询已创建任务，无需一直打开工作台。`,
        requestBody: body({ type: "object", required: ["model", "prompt"], additionalProperties: false, properties: {
          model: { type: "string" }, prompt: { type: "string", minLength: 1, maxLength: 10000 }, n: { type: "integer", enum: [1] },
          resolution: { type: "string", example: "2k" }, quality: { type: "string", enum: ["low", "medium", "high", "auto", "standard", "hd"] }, version: { type: "string", description: "按模型选择：flare/sunburst，或 Midjourney 的 5.1/5.2/6.1/7/8.1/8.2；niji=true 时为 6 或 7。" }, niji: { type: "boolean", description: "仅 Midjourney，启用动漫模型。" }, speed: { type: "string", enum: ["relax", "fast", "turbo"], description: "仅 Midjourney。" }, size: { type: "string", example: "1:1" }, image_urls: { type: "array", maxItems: 10, items: { type: "string", format: "uri" } },
        } }, { model: "gpt-image-2", prompt: "晨光中的山间小屋，水彩画风格。", n: 1, resolution: "2k", size: "1:1" }),
        responses: { "200": response("任务编号与预留金额。"), ...errors },
      } },
      [BASE + "/v1/videos/generations"]: { post: {
        summary: "创建 tokvilo 视频任务", tags: ["tokvilo · 视频"], parameters: idempotency,
        description: `${auth} 仅支持价格目录 billingReady=true 的已适配模型与参数。必须明确填写 duration；按模型选择 resolution 或 mode。不同模型的时长、分辨率和音轨限制不同，报价与生成使用相同校验。wan2.7-r2v 支持 1–5 张参考图、2–15 秒、720P/1080P；image_with_roles 使用 reference_image 或单个 first_frame，也可用 image_urls 自动转换为 reference_image。参考视频、音频素材、编辑、续写、动作迁移与自动时长尚未开放。提交后使用统一任务接口查询；失败退回预留，未知结果保留预留。`,
        requestBody: body({ type: "object", required: ["model", "prompt", "duration"], properties: {
          model: { type: "string" }, prompt: { type: "string", minLength: 1, maxLength: 10000 }, duration: { type: "integer", minimum: 1, maximum: 30 }, resolution: { type: "string" }, mode: { type: "string", enum: ["std", "pro", "4k"] },
          audio: { type: "boolean" }, generate_audio: { type: "boolean" }, aspect_ratio: { type: "string" }, size: { type: "string" }, image_urls: { type: "array", maxItems: 10, items: { type: "string", format: "uri" } },
          image_with_roles: { type: "array", minItems: 1, maxItems: 5, description: "wan2.7-r2v 的图片参考模式；最多一张 first_frame，其余为 reference_image，省略 role 时默认 reference_image。其他支持首尾帧的型号按各自限制使用 first_frame/last_frame。", items: { type: "object", required: ["url"], additionalProperties: false, properties: { url: { type: "string", format: "uri" }, role: { type: "string", enum: ["reference_image", "first_frame", "last_frame"] } } } },
        } }, { model: "veo3.1-fast", prompt: "晨光中的海岸，镜头缓缓前进。", duration: 8, resolution: "720p" }),
        responses: { "200": response("data[0].task_id 为已受理任务编号，tokvilo_billing 为余额预留。"), ...errors },
      } },
      [BASE + "/v1/music/generations"]: { post: {
        summary: "创建 tokvilo 音乐任务", tags: ["tokvilo · 音乐"], parameters: idempotency,
        description: `${auth} Suno 仅支持 v6、v6-mini、v6-wild；custom=false 时 prompt 为音乐描述，自定义模式可填写歌词或 instrumental=true。max_mode 需要 custom=true，并会改变本次报价。Flow Music 使用 sound_prompt 或 lyrics（至少一个）。私有训练模型、翻唱、延长、分轨、上传与其他音乐动作尚未开放。`,
        requestBody: body({ type: "object", required: ["model"], properties: {
          model: { type: "string", enum: ["suno", "flowmusic"] }, prompt: { type: "string", maxLength: 5000 }, custom: { type: "boolean" }, instrumental: { type: "boolean" }, version: { type: "string", enum: ["v6", "v6-mini", "v6-wild"] },
          title: { type: "string" }, style: { type: "string", maxLength: 1000 }, negative_tags: { type: "string", maxLength: 1000 }, max_mode: { type: "boolean" }, duration: { type: "integer", minimum: 10, maximum: 360 },
          sound_prompt: { type: "string", maxLength: 10000 }, lyrics: { type: "string", maxLength: 10000 }, length: { type: "integer", minimum: 1, maximum: 240 }, bpm: { type: "string" }, seed: { type: "string" },
        } }, { model: "flowmusic", sound_prompt: "安静的钢琴与柔和雨声，适合阅读。", length: 120 }),
        responses: { "200": response("音乐任务编号；用统一任务接口查询 data.result.music 中的音频结果。"), ...errors },
      } },
      [BASE + "/v1/music/tasks/{task_id}"]: { get: { summary: "查询当前账户的音乐任务", tags: ["tokvilo · 音乐"], description: "与统一任务查询等价；只允许查询本站创建且属于当前账户的任务。",
        parameters: [{ name: "task_id", in: "path", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{1,160}$" } }], responses: { "200": response("音乐任务状态、结果和结算。"), ...errors },
      } },
      [BASE + "/v1/tasks"]: { get: { summary: "列出当前账户的 tokvilo 生成任务", tags: ["tokvilo 模型服务 · 图片"], description: "返回当前账户在本站创建的最近 50 个任务。任务列表不会创建生成请求。", responses: { "200": response("任务 ID、模型、状态和时间。"), ...errors } } },
      [BASE + "/v1/tasks/{task_id}"]: { get: { summary: "查询 tokvilo 生成结果", tags: ["tokvilo 模型服务 · 图片"], description: "只允许查询属于当前账户的任务。completed 后查看 data.result.images、videos 或 music 和 tokvilo_billing；媒体 URL 可能有过期时间。重复查询不会重复扣款。",
        parameters: [{ name: "task_id", in: "path", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{1,160}$" }, example: "task_id_from_create_response" }],
        responses: { "200": response("任务状态、结果与最终结算。"), "404": response("此账户没有对应任务。"), ...errors },
      } },
    },
  };
}
