import { TOKENHUB_MODEL_REFERENCE_DATE, TOKENHUB_REFERENCE_MODELS } from "./tokenhub-model-reference";

const BASE = "/api/studio";
const TASKS = BASE + "/v3/contents/generations/tasks";
const models = (kind: "chat" | "image" | "video") => TOKENHUB_REFERENCE_MODELS.filter(model => model.kind === kind).map(model => model.id);
const auth = "使用当前账户的 tokvilo API Key（tk_live_ 前缀，兼容旧 eco_live_），不要提交上游密钥。会员按上游价格加价 20% 从余额结算；浏览器写操作要求同源 Origin。";
const modelDescription = `以下枚举是 ${TOKENHUB_MODEL_REFERENCE_DATE} 的模型参考。完整实时目录通过 GET ${BASE}/v1/models 获取；新增模型以目录返回的 endpoint 和 integrationStatus 为准。目录在列不等于账户已获该模型调用权限。`;
const jsonResponse = (description: string, schema: unknown = { type: "object", additionalProperties: true }) => ({ description, content: { "application/json": { schema } } });
const errors = {
  "400": jsonResponse("请求参数不合法。"), "401": jsonResponse("tokvilo API Key 无效或登录已过期。"),
  "402": jsonResponse("账户余额不足。"), "403": jsonResponse("账户已停用，或浏览器写操作不是同源请求。"), "429": jsonResponse("请求限流，请按返回提示等待。"),
  "502": jsonResponse("上游未完整返回；收费请求结果可能待确认，不要盲目重复提交。"), "503": jsonResponse("服务或上游配置当前不可用。"),
};
const idempotency = [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 8, maxLength: 128 }, example: "replace_with_unique_request_id", description: "每次新请求使用新编号，同一请求重试保持相同编号与请求体。" }];
const body = (schema: unknown, example: unknown) => ({ required: true, content: { "application/json": { schema, example } } });

export function tokenHubOpenApi(baseUrl: string): Record<string, unknown> {
  return {
    openapi: "3.0.3",
    info: { title: "tokvilo 多模态 API", version: "1.0.0", description: `${auth} tokvilo 多模态 文档独立于数据接口目录。文本返回完整 JSON，当前不支持流式返回。` },
    servers: [{ url: baseUrl.replace(/\/+$/, "") }],
    security: [{ TokviloBearer: [] }],
    components: { securitySchemes: { TokviloBearer: { type: "http", scheme: "bearer", bearerFormat: "tokvilo API Key", description: auth } } },
    tags: [{ name: "tokvilo 多模态 · 模型" }, { name: "tokvilo 多模态 · 文本" }, { name: "tokvilo 多模态 · 图片" }, { name: "tokvilo 多模态 · 视频" }],
    paths: {
      [BASE + "/v1/models"]: { get: {
        operationId: "studioModels", summary: "获取 tokvilo 多模态 全模型目录", tags: ["tokvilo 多模态 · 模型"],
        description: `${auth} 合并模型接口与价格市场，包含文本、图片和视频。检查 catalog.complete、各来源状态以及 data[].integrationStatus、endpoint、accountAccess；价格来源失败时返回明确的部分目录，不伪装成完整清单。当前参考共 ${TOKENHUB_REFERENCE_MODELS.length} 个模型，新模型也会出现在此目录。`,
        responses: { "200": jsonResponse("完整或明确标注的部分目录。", { type: "object", properties: {
          object: { type: "string", example: "list" }, data: { type: "array", items: { type: "object", properties: {
            id: { type: "string" }, modelType: { type: "string" }, integrationStatus: { type: "string", enum: ["ready", "catalog_only"] },
            endpoint: { type: "string", nullable: true }, accountAccess: { type: "string", enum: ["listed_by_authenticated_model_api", "unverified_public_catalog"] },
          }, additionalProperties: true } }, catalog: { type: "object", properties: { complete: { type: "boolean" } }, additionalProperties: true },
        } }), ...errors },
      } },
      [BASE + "/v1/chat/completions"]: { post: {
        parameters: idempotency, operationId: "studioChat", summary: "tokvilo 多模态 文本对话", tags: ["tokvilo 多模态 · 文本"],
        description: `${auth} ${modelDescription} stream 必须为 false。OpenAI 兼容客户端的文本 base_url 为 ${baseUrl.replace(/\/+$/, "")}${BASE}/v1。超时后先核对上游调用记录；会员所有生成请求必须提供 Idempotency-Key，重试沿用同一编号。`,
        requestBody: body({ type: "object", required: ["model", "messages"], properties: {
          model: { type: "string", enum: models("chat"), description: modelDescription },
          messages: { type: "array", minItems: 1, maxItems: 200, items: { type: "object", required: ["role", "content"], properties: { role: { type: "string", enum: ["system", "user", "assistant"] }, content: { type: "string" } }, additionalProperties: true } },
          stream: { type: "boolean", enum: [false], default: false }, max_tokens: { type: "integer", minimum: 1, description: "输出上限。思考模型的推理也可能消耗输出额度，具体上限以所选模型为准。" },
        }, additionalProperties: true }, { model: "deepseek-v4-flash-ga-260731", messages: [{ role: "user", content: "请用一句话介绍自己。" }], max_tokens: 8192, stream: false }),
        responses: { "200": jsonResponse("对话结果与 usage，包含模型返回的推理字段（如有）。"), ...errors },
      } },
      [BASE + "/v3/images/generations"]: { post: {
        parameters: idempotency, operationId: "studioImage", summary: "tokvilo 多模态 图片生成", tags: ["tokvilo 多模态 · 图片"],
        description: `${auth} ${modelDescription} 使用图片专属 v3 路径。以下为最小文字生成图片示例；未添加当前模型不支持的 sequential_image_generation 参数。图片和文本超时后均须先核对调用记录。`,
        requestBody: body({ type: "object", required: ["model", "prompt"], properties: {
          model: { type: "string", enum: models("image"), description: modelDescription }, prompt: { type: "string", minLength: 1 },
          size: { type: "string", example: "2K", description: "示例使用 2K；其他尺寸以所选模型的支持范围为准。" },
          response_format: { type: "string", example: "url" }, watermark: { type: "boolean" },
        }, additionalProperties: true }, { model: "dola-seedream-5-0-pro-260628", prompt: "白色桌面上的红色木方块与蓝色陶瓷球，柔和棚拍光。", size: "2K", response_format: "url", watermark: false }),
        responses: { "200": jsonResponse("图片 URL 与返回元数据。"), ...errors },
      } },
      [TASKS]: {
        get: { operationId: "studioTaskList", summary: "列出当前账户的 tokvilo 多模态 视频任务", tags: ["tokvilo 多模态 · 视频"],
          description: `${auth} 返回当前 tokvilo 账户在本站创建的最近 50 个任务；这是本地任务记录，不会创建视频，也不接受查询参数。实时状态通过任务详情接口读取。`,
          responses: { "200": jsonResponse("当前账户的本地任务列表。"), ...errors } },
        post: { operationId: "studioVideo", summary: "创建 tokvilo 多模态 视频任务", tags: ["tokvilo 多模态 · 视频"],
          description: `${auth} ${modelDescription} 创建后保存返回 id，通过同一账户查询。每次新任务使用新的 Idempotency-Key；同一次提交重试必须沿用同一编号和完全相同的请求体。结果未知时会返回 409，不能通过更换编号来重复生成。`,
          parameters: [{ name: "Idempotency-Key", in: "header", required: true, description: "新任务使用新的 8–128 位字母、数字、下划线或连字符；同一任务重试保持不变。", schema: { type: "string", minLength: 8, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" }, example: "replace_with_unique_request_id" }],
          requestBody: body({ type: "object", required: ["model", "content"], properties: {
            model: { type: "string", enum: models("video"), description: modelDescription },
            content: { type: "array", minItems: 1, maxItems: 32, items: { type: "object", properties: { type: { type: "string", example: "text" }, text: { type: "string" } }, additionalProperties: true } },
            duration: { type: "integer", description: "4–15 秒，或 -1 由上游选择；所选模型可能有更窄的支持范围。", example: 4 },
            resolution: { type: "string", example: "480p" }, ratio: { type: "string", example: "16:9" }, generate_audio: { type: "boolean" }, watermark: { type: "boolean" },
          }, additionalProperties: true }, { model: "dreamina-seedance-2-0-fast-260128", content: [{ type: "text", text: "白桌上的蓝色球缓慢向右滚动，一个连续固定镜头。" }], duration: 4, resolution: "480p", ratio: "16:9", generate_audio: false, watermark: false }),
          responses: { "200": jsonResponse("任务已受理，保存返回的 id；不代表视频已经生成完毕。"), "201": jsonResponse("任务已创建，保存返回的 id。"), "409": jsonResponse("同一编号的请求体不一致，或此前提交结果尚未确认。"), ...errors },
        },
      },
      [TASKS + "/{task_id}"]: {
        get: { operationId: "studioTaskGet", summary: "查询 tokvilo 多模态 视频任务", tags: ["tokvilo 多模态 · 视频"],
          description: `${auth} 只允许查询当前 tokvilo 账户在本站创建的任务。返回 status；仅在生成成功后读取视频 URL。`,
          parameters: [{ name: "task_id", in: "path", required: true, description: "创建任务接口返回的 id。", schema: { type: "string", pattern: "^[A-Za-z0-9_-]{1,160}$" }, example: "task_id_from_create_response" }],
          responses: { "200": jsonResponse("上游实时任务状态及媒体结果（如已完成）。"), "404": jsonResponse("当前账户没有该任务。"), ...errors } },
        delete: { operationId: "studioTaskDelete", summary: "取消或删除 tokvilo 多模态 视频任务", tags: ["tokvilo 多模态 · 视频"],
          description: `${auth} 只允许操作当前账户在本站创建的任务。能否取消由任务状态及上游决定；取消或删除不等于已退费。`,
          parameters: [{ name: "task_id", in: "path", required: true, description: "创建任务接口返回的 id。", schema: { type: "string", pattern: "^[A-Za-z0-9_-]{1,160}$" }, example: "task_id_from_create_response" }],
          responses: { "200": jsonResponse("返回取消／删除结果；上游空 204 被规范为 JSON 状态 cancelled_or_deleted。"), "404": jsonResponse("当前账户没有该任务。"), ...errors } },
      },
    },
  };
}
