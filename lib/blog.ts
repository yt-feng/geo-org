import { CREDIT_EXCHANGE_LABEL, formatCreditsWithUsd } from "./credits";
import type { Metadata } from "next";

export type BlogLocale = "zh" | "en";
export type BlogSection = {
  id: string;
  title: string;
  paragraphs: string[];
  list?: string[];
  code?: { language: string; value: string; caption: string };
  table?: { headers: string[]; rows: string[][] };
};
export type BlogContent = {
  title: string;
  description: string;
  category: string;
  lead: string[];
  takeaways: string[];
  sections: BlogSection[];
  cta: { title: string; description: string; label: string; href: string };
};
export type BlogPost = {
  slug: string;
  date: string;
  author: "tokvilo";
  readMinutes: number;
  theme: "start" | "compare" | "usage";
  content: Record<BlogLocale, BlogContent>;
};

export const blogPosts: BlogPost[] = [
  {
    slug: "getting-started-with-model-apis", date: "2026-10-23", author: "tokvilo", readMinutes: 5, theme: "start",
    content: {
      zh: {
        title: "从模型目录到第一次 API 请求",
        description: "把发现模型、准备账户、确认报价和检查结果连成一条清晰路径，开始使用 tokvilo API 与 Playground。",
        category: "接入指南",
        lead: ["开始接入模型时，最有用的第一步是把任务说清楚：你要生成一段文本、一张图像，还是处理已有内容？任务决定需要检查的模型能力、输入形式和计费单位。", "这篇指南按 tokvilo 的实际使用流程展开，从无需登录的目录查询，到账户准备、工作台试用与程序接入。模型展示在目录中，不代表它在任何时刻都能成功执行；发起请求前仍需检查对应服务状态。"],
        takeaways: ["先用模型目录确认任务和型号，再准备调用。", "Playground 需要有效账户、可用服务与足够额度。", "确认报价后发起一次请求，并保留原请求编号。"],
        sections: [
          { id: "start-with-a-task", title: "1. 先用一个具体任务缩小范围", paragraphs: ["把“我要试试 AI”换成一份可以检查结果的任务说明。例如：将一段产品介绍改写成 150 字以内的说明，保留指定事实，并输出三个要点。这样的任务让你更容易判断结果是否符合要求。", "在模型市场按文本、图像、视频或音频选择用途，再按厂商和系列浏览。进入系列后，检查模型名称、版本、支持的输入形式，以及页面展示的价格与接口信息。"], list: ["输入：文字、图片、音频或其他材料。", "输出：内容形式、长度和结构。", "约束：必须保留的事实、语言和交付要求。"] },
          { id: "read-the-catalogue", title: "2. 先读取公开目录", paragraphs: ["目录查询可以用于确认站点可访问，并了解页面对外提供的模型信息。下面的请求读取公开目录，不会执行模型生成，也不需要 API 密钥。", "返回成功只说明目录请求完成。后续生成请求使用什么接口、需要哪些参数，应以所选模型的文档为准。"], code: { language: "cURL", value: 'curl --fail --show-error \\\n  "https://tokvilo.com/api/model-catalog"', caption: "公开目录查询；不会发起付费模型调用。" } },
          { id: "prepare-your-account", title: "3. 准备账户与服务用量", paragraphs: ["注册并登录后，在控制台检查账户和可用额度。英文版提供 tokvilo 用量包在线购买或企业银行转账安排；在线支付是否开放，以支付页面和账户中显示的状态为准。", "企业转账先通过支持邮箱确认企业资料、账户邮箱、购买金额和付款说明。管理员核实实际到账后，再将约定的服务用量计入指定账户。不要把提交咨询或返回付款页面当成入账成功。"], list: ["核对当前登录邮箱，确认使用正确账户。", "查看支付方式与账户流水，确认服务用量已到账。", "如果页面提示服务未配置、账户异常或余额不足，先解决提示中的问题。"] },
          { id: "try-playground", title: "4. 在 Playground 检查参数与报价", paragraphs: ["从选定模型进入 Playground，先用一份短小、可验证的输入。确认模型 ID 与预期一致，再填写必要参数。模型和任务不同，表单及可填写的参数也可能不同。", "报价与执行是两个步骤。获取报价后，检查金额和参数，再确认发起生成。文本长度、输出限制、图片规格或视频参数的改变可能影响报价；修改参数后应重新确认。", "发起后保留原请求编号。若页面仍在处理中，先查看原请求状态；若浏览器连接中断，也不要直接把同一个任务重复提交为新请求。" ] },
          { id: "move-into-your-app", title: "5. 将确认过的请求接入应用", paragraphs: ["工作台帮助你理解模型输入和输出，但程序接入还需要查看接口文档。不同类型的模型可能使用不同协议，或采用提交任务后查询状态的异步流程。不要假设所有模型都能使用同一个请求体。", "在控制台创建用于应用的 tokvilo API 密钥。将密钥保存在你的服务端环境中，避免放进公开代码仓库或浏览器前端。按照所选接口的文档处理身份验证、请求参数、错误响应和任务状态。", "上线前留下一份最小验收记录：所选模型、参数、请求编号、结果是否满足任务，以及控制台的实际结算记录。这样更容易把调用问题与应用逻辑问题区分开。" ] },
        ],
        cta: { title: "从一个清楚的任务开始", description: "浏览模型系列，确认所需能力和当前接口状态，再进入工作台。", label: "打开模型市场", href: "/models" },
      },
      en: {
        title: "From the model catalogue to your first API request",
        description: "Follow a practical path through model discovery, account setup, quotes and results to get started with tokvilo APIs and Playground.",
        category: "Getting started",
        lead: ["Start with a concrete task: are you generating text, creating an image, or processing existing material? The task determines which capabilities, inputs and billing units you need to check.", "This guide follows the tokvilo workflow, from a public catalogue request to account setup, a Playground trial and application integration. A model appearing in the catalogue does not guarantee that every request will succeed. Check the relevant service status before submitting."],
        takeaways: ["Use the catalogue to identify the task and exact model first.", "Playground needs an active account, an available service and sufficient usage balance.", "Confirm the quote, submit once and retain the original request ID."],
        sections: [
          { id: "start-with-a-task", title: "1. Narrow the choice with a concrete task", paragraphs: ["Turn “try AI” into an outcome you can inspect. For example: rewrite a product description in under 150 words, preserve the supplied facts, and return three points. A specific task makes the result easier to assess.", "In the model library, choose text, image, video or audio, then browse creators and model families. Within a family, check the model name, version, supported inputs, pricing and interface details shown on the page."], list: ["Input: text, images, audio or other material.", "Output: the required format, length and structure.", "Constraints: facts to preserve, language and delivery requirements."] },
          { id: "read-the-catalogue", title: "2. Read the public catalogue", paragraphs: ["A catalogue request helps you check access to the site and inspect its public model information. The following request reads the catalogue without an API key. It does not run a model or generate content.", "A successful response confirms only that the catalogue request worked. The endpoint and parameters for generation depend on the selected model's documentation."], code: { language: "cURL", value: 'curl --fail --show-error \\\n  "https://tokvilo.com/api/model-catalog"', caption: "Public catalogue lookup. This does not trigger a paid model request." } },
          { id: "prepare-your-account", title: "3. Prepare your account and service usage", paragraphs: ["After registering and signing in, check your account and available usage balance in the console. The English site offers online checkout for tokvilo usage packs or enterprise bank transfer arrangements. Check the payment page and account for current online checkout availability.", "For an enterprise transfer, contact support first to confirm company details, your account email, the amount and payment instructions. An administrator adds the agreed usage after verifying the bank receipt. An inquiry or a return from a payment page does not itself confirm delivery."], list: ["Check the signed-in email so the right account receives usage.", "Review payment availability and your ledger to confirm that usage was added.", "Resolve any service configuration, account or insufficient-balance message before continuing."] },
          { id: "try-playground", title: "4. Check parameters and a quote in Playground", paragraphs: ["Open Playground from the selected model and begin with a short input whose output you can check. Confirm the exact model ID, then fill in the required parameters. Forms and supported options vary by model and task.", "Getting a quote and executing a request are separate steps. Review the amount and parameters, then confirm generation. Changes to text length, output limits, image specifications or video settings can change the quote; confirm it again after editing.", "Keep the original request ID after submission. If the request is processing, check that request. A browser disconnection is also a reason to inspect its status before submitting a new copy of the same task." ] },
          { id: "move-into-your-app", title: "5. Move the verified request into your application", paragraphs: ["Playground helps you understand inputs and outputs, while application integration also requires the API documentation. Different model types may use different protocols or an asynchronous submit-and-poll flow. Do not assume every model accepts the same request body.", "Create a tokvilo API key for your application in the console. Keep it in your server environment, away from public repositories and browser code. Follow the selected endpoint's documentation for authentication, parameters, errors and task states.", "Before releasing your integration, record the model, parameters, request ID, whether the output met the task, and the actual settlement shown in the console. That small acceptance record helps separate a request problem from application logic." ] },
        ],
        cta: { title: "Begin with a task you can evaluate", description: "Browse model families, check the capabilities and current interface status, then open the workspace.", label: "Explore the model library", href: "/models" },
      },
    },
  },
  {
    slug: "comparing-models-for-your-workflow", date: "2026-10-23", author: "tokvilo", readMinutes: 5, theme: "compare",
    content: {
      zh: {
        title: "把模型比较，变成可重复的工作流程",
        description: "从同一任务和验收标准出发，比较模型家族、代际与规格，记录质量、耗时和实际用量。",
        category: "模型选择",
        lead: ["在同一家族里，新一代、轻量规格、推理版本和特定用途版本可能并存。名称只能帮助你定位，真正的选择要回到工作内容：哪些结果可以直接使用，哪些需要较多修改？", "一个可重复的比较流程，可以让你逐步缩小选择范围，而不必每次重新浏览一长页型号。这篇文章介绍如何用 tokvilo 的厂商、系列和版本视图整理候选，并建立自己的任务记录。"],
        takeaways: ["先写验收标准，再选择候选模型。", "同一任务使用相同材料和输出要求，保留完整参数。", "分别记录可用质量、耗时与实际计费，不用一个分数代替全部判断。"],
        sections: [
          { id: "define-acceptance", title: "1. 先写一份验收说明", paragraphs: ["挑选一到三个真实任务，把结果必须满足的条件写下来。任务要能代表你的日常工作，也要允许你对不同结果采用同一套判断。", "例如，比较用于产品说明的文本模型时，你可以检查事实是否保留、输出结构是否正确、字数是否合适，以及需要多少人工修改。不要只凭某一次措辞是否惊艳做决定。"], list: ["必选条件：事实、结构、语言或文件格式。", "可以接受的调整：需要你修改的内容类型。", "实际限制：输入长度、响应时间和预算范围。"] },
          { id: "build-a-shortlist", title: "2. 按厂商、系列、代际整理候选", paragraphs: ["先在模型市场按用途筛选，再选择厂商和系列。这样可以先比较 GPT、Claude、Gemini、DeepSeek 等家族中的相关型号，而不是把所有用途混在一起。", "同系列的不同版本适合放在相邻位置比较，但版本号本身并不说明哪个更适合你的任务。确认每个型号支持的输入、所需接口和计费单位，并用两到三个候选开始测试。", "如果筛选后没有结果，检查已选的用途、厂商和系列是否相交。清除不再适用的条件再查找，比直接推断某个型号不存在更可靠。" ] },
          { id: "make-runs-comparable", title: "3. 让每次试用能够对照", paragraphs: ["为候选模型使用相同的任务说明、参考材料和输出要求。能保持一致的参数尽量一致；不能对应的参数，应明确记录。比如两个模型支持不同的图片尺寸，就需要说明这不是完全相同的规格。", "在 Playground 获取各自报价并确认执行。记录请求编号、模型 ID 和所用参数，随后检查结果与结算。若某次调用失败或等待核对，把状态单独记录，不要把它当成已完成的质量样本。"], table: { headers: ["记录项", "为什么有用"], rows: [["模型 ID 与版本", "确保比较的具体型号可以复查"], ["输入与参数", "确认结果差异来自哪些条件"], ["请求状态与编号", "区分成功、失败与待确认记录"], ["人工修改与实际结算", "判断日常使用的真实成本"]] } },
          { id: "keep-dimensions-separate", title: "4. 把质量、耗时、用量分开看", paragraphs: ["结果可以分成“直接可用”“修改后可用”和“不满足要求”等与你任务相关的类别。耗时要结合你的工作方式：交互式助手和离线批处理的要求并不相同。", "费用比较应使用实际计费单位和结算记录。文本、图片、视频等任务的计量方式不同，不能仅比较页面上的数字大小。相同任务多做几次记录，也能帮助你看到结果的一致性。", "这些记录描述的是你自己的任务样本，不是通用榜单。没有足够样本和一致条件时，不应据此声称某个模型在所有场景都更快、更准确或更便宜。" ] },
          { id: "review-your-choice", title: "5. 为当前任务保留首选和备选", paragraphs: ["为每类工作保留一个首选型号，以及一个已经试用过的备选。备选不仅要名字相近，还要确认它的输入形式、参数和结果处理方式能与你的应用配合。", "当模型版本、价格、可用状态或任务要求发生变化时，用原来的任务说明重新比较。保留先前的记录，让调整选择有据可循。" ] },
        ],
        cta: { title: "把候选型号放在同一视图", description: "按厂商与模型系列浏览各代版本，从两到三个候选开始比较。", label: "比较模型系列", href: "/models" },
      },
      en: {
        title: "Make model comparison a repeatable workflow",
        description: "Compare model families, generations and variants against the same task, then record usable quality, timing and actual usage.",
        category: "Choosing models",
        lead: ["A model family can include newer generations, lighter variants, reasoning models and versions built for particular tasks. Names help you navigate, but the decision comes back to your work: which outputs are usable, and which require substantial editing?", "A repeatable process helps you narrow the choice without revisiting a long catalogue from scratch. Use tokvilo's creator, family and version views to organize candidates, then build a record of how they handle your own tasks."],
        takeaways: ["Define acceptance criteria before choosing candidates.", "Use the same material and output requirements, and retain the parameters.", "Record quality, timing and actual billing separately instead of reducing them to one score."],
        sections: [
          { id: "define-acceptance", title: "1. Write an acceptance brief first", paragraphs: ["Choose one to three real tasks and write down what an acceptable result must do. The tasks should represent your work and let you judge each candidate against the same conditions.", "For product-description writing, for example, inspect whether facts are preserved, the structure is correct, the length is suitable and the output needs editing. An impressive phrase in one response is too narrow a basis for a decision."], list: ["Required conditions: facts, structure, language or file format.", "Acceptable editing: what you are willing to change yourself.", "Practical limits: input length, response time and budget."] },
          { id: "build-a-shortlist", title: "2. Organize candidates by creator, family and generation", paragraphs: ["Filter by task in the model library, then select a creator and family. This lets you inspect relevant versions within families such as GPT, Claude, Gemini and DeepSeek without mixing unrelated tasks into the same shortlist.", "Versions in one family are useful to compare side by side, but a version number does not tell you which one best fits your task. Check supported inputs, the required interface and billing units, then begin with two or three candidates.", "If a filter combination has no results, check whether the selected task, creator and family overlap. Remove a condition that no longer applies before concluding that a model is absent." ] },
          { id: "make-runs-comparable", title: "3. Make the trials comparable", paragraphs: ["Give each candidate the same task brief, reference material and output requirements. Keep equivalent parameters consistent, and record differences when options do not map. Different supported image sizes, for example, mean the runs are not using identical specifications.", "Get each quote in Playground and confirm execution. Record the request ID, exact model ID and parameters, then inspect the output and settlement. Record failed or unconfirmed requests separately instead of counting them as completed quality samples."], table: { headers: ["Record", "Why it helps"], rows: [["Model ID and version", "Makes the exact candidate traceable"], ["Inputs and parameters", "Shows which conditions differed"], ["Request status and ID", "Separates completed, failed and unconfirmed runs"], ["Editing and settlement", "Shows the practical cost of using the result"]] } },
          { id: "keep-dimensions-separate", title: "4. Keep quality, timing and usage separate", paragraphs: ["Classify results in terms useful to your task: usable immediately, usable with edits, or does not meet the brief. Consider timing in the context of the workflow; an interactive assistant and an offline batch have different requirements.", "Compare costs using the billing unit and actual settlement. Text, image and video tasks can use different measures, so the size of a displayed number is not enough. Repeating the same task also helps you assess consistency.", "Your notes describe your task sample, not a universal leaderboard. Without sufficient samples and consistent conditions, they do not establish that a model is always faster, more accurate or less expensive." ] },
          { id: "review-your-choice", title: "5. Keep a primary choice and a tested alternative", paragraphs: ["Choose a primary model for each type of work and retain an alternative you have actually tried. A similar name is not enough: check that the alternative's inputs, parameters and result handling work with your application.", "When a version, price, availability or task requirement changes, repeat the comparison using the original brief. Keeping previous records makes the next decision easier to explain." ] },
        ],
        cta: { title: "Bring candidates into the same view", description: "Browse creators and model families, then compare generations using a small shortlist.", label: "Compare model families", href: "/models" },
      },
    },
  },
  {
    slug: "understanding-api-usage-and-billing", date: "2026-10-23", author: "tokvilo", readMinutes: 5, theme: "usage",
    content: {
      zh: {
        title: "报价、预留与结算：看懂一次 API 调用的账单",
        description: "理清服务用量购买、请求报价、额度预留和最终结算，知道处理中、失败或退款时应该查看什么。",
        category: "用量与账务",
        lead: ["为账户购买服务用量，与一次模型调用的结算，是两个不同层面的记录。前者说明可用服务用量从哪里来，后者说明某次请求实际消耗了多少。", "把它们放回对应流程，就更容易理解为什么提交任务后可用额度暂时减少、任务结束后又释放一部分，以及什么时候需要查询原请求或联系支持。"],
        takeaways: ["购买服务用量后，仍按模型的实际计费规则消耗。", "报价用于确认请求；预留与最终结算不一定相同。", "连接中断不等于请求失败，先查看原请求状态。"],
        sections: [
          { id: "purchase-and-usage", title: "1. 服务用量购买与调用消费分开记录", paragraphs: [`tokvilo 的 API 服务用量用于当前账户的 API 与 Playground。API 积分是这笔服务余额的显示单位，固定 ${CREDIT_EXCHANGE_LABEL.zh}，页面同时保留美元等值。显示单位不改变模型售价、实际用量或扣费。一次性用量包不自动续费，也不承诺固定的调用次数；可以执行多少工作，取决于模型、参数和实际消耗。`, "在线购买时，以收银台的最终金额和支付确认记录为准。企业转账按邮件确认的安排办理，管理员核实实际到账后入账。税费不计入 API 积分。数字商品的人民币参考售价独立展示，API 积分不用于购买这些商品。购买和到账记录不能代替具体请求的结算明细。" ] },
          { id: "read-a-quote", title: "2. 报价要和计费单位一起看", paragraphs: ["不同模型和任务可能按输入与输出用量、图片数量、视频规格或其他接口单位计费。价格页面同时展示 tokvilo 的积分售价与美元等值；比较之前，先确认单位是否相同。", "Playground 的报价对应当前模型和参数。更换模型、增加输入或修改输出规格后，需要重新查看报价。报价用于帮助你决定是否发起这一次请求，不应被理解为所有后续请求都采用同一金额。"], list: ["确认模型 ID 和当前选项。", "检查数量、长度、分辨率或其他影响金额的参数。", "核对计费单位与本次请求的报价，再确认执行。"] },
          { id: "reservation-and-settlement", title: "3. 预留是任务期间占用的积分", paragraphs: ["请求提交时，系统按本次请求的报价预留相应积分。预留期间，这部分余额不能再被其他请求重复使用。结果和实际消耗确认后，系统完成结算，并释放可退回的剩余预留。", `下面是仅用于解释流程的假设例子，不代表任何模型的实际价格：某次请求预留 ${formatCreditsWithUsd(100_000, "zh")}，最终确认消耗 ${formatCreditsWithUsd(60_000, "zh")}，则释放剩余 ${formatCreditsWithUsd(40_000, "zh")}。核对真实账单时，始终以对应请求的结算记录为准。`], table: { headers: ["阶段", "应查看的内容"], rows: [["报价", "当前模型、参数与拟预留积分及美元等值"], ["预留", "原请求编号和任务状态"], ["结算", "确认消耗以及释放的剩余积分"], ["账务调整", "与原请求或付款关联的调整记录"]] } },
          { id: "when-a-request-is-pending", title: "4. 网络中断时先查询原请求", paragraphs: ["浏览器等待超时，只能说明你没有在该次连接中收到完整结果。请求可能仍在处理，也可能需要进一步核对。此时直接提交一份新任务，可能产生两个独立请求。", "保留原请求编号，使用页面的查询或恢复操作检查状态。任务处于待核对状态时，相关预留可能暂时保留；支持人员可以根据编号核对调用与账务记录。", "如果收到明确的余额不足提示，先检查可用额度和已经被其他任务预留的部分。账户里有历史购买记录，并不意味着当前可用额度足够执行任何请求。" ] },
          { id: "refunds-and-support", title: "5. 释放预留与退款是不同流程", paragraphs: ["请求结束后释放剩余预留，会恢复可用服务额度；这不是退回银行卡或银行账户的现金退款。付款退款需要核查购买记录、服务交付、实际使用和适用的退款规则。", "重复付款、付款后未入账、未提供的服务或疑似错误扣费，都可以联系支持核查。请提供账户邮箱、原交易或银行流水编号，以及相关请求编号。不要发送密码、API 密钥或完整银行卡信息。", "在线购买的退款适用相应退款政策及不可放弃的法定权利。退款获批后会调整对应的服务用量。你可以在支付说明与退款政策页面查看处理方式。" ] },
        ],
        cta: { title: "先了解支付，再确认用量", description: "查看 API 服务用量包、企业转账安排，以及付款和退款政策。", label: "继续付款", href: "/billing" },
      },
      en: {
        title: "Quotes, reservations and settlement: understand an API charge",
        description: "Separate service purchases from request quotes, reserved usage and final settlement, and know what to check when a request is pending or a refund is needed.",
        category: "Usage & billing",
        lead: ["Buying service usage for your account and settling an individual model request are different records. The purchase explains where your available usage came from; settlement explains how much a particular request consumed.", "Following each record through its own process makes temporary balance changes easier to understand. It also helps you decide when to check the original request and when to contact support."],
        takeaways: ["Purchased service usage is consumed at the selected model's billing rates.", "A quote confirms a request; its reservation and final settlement may differ.", "A disconnected browser does not prove the request failed. Check the original request first."],
        sections: [
          { id: "purchase-and-usage", title: "1. Separate a service purchase from request consumption", paragraphs: [`tokvilo API usage belongs to the purchasing account and can be used in its APIs and Playground. API credits are a display unit for that service balance, at a fixed ${CREDIT_EXCHANGE_LABEL.en}, with the USD equivalent shown alongside. This unit does not change model rates, actual usage or charges. One-time packs do not automatically renew or promise a fixed number of requests. What you can run depends on the model, parameters and actual consumption.`, "For online purchases, check the final checkout amount and verified payment record. Enterprise transfers follow the arrangements confirmed by email, with usage added after an administrator verifies receipt. Taxes do not add API credits. Digital goods keep their separate indicative CNY prices and cannot be purchased with API credits. A purchase or allocation record does not replace a particular request's settlement details." ] },
          { id: "read-a-quote", title: "2. Read the quote together with its billing unit", paragraphs: ["Different models and tasks may charge by input and output usage, image count, video specifications or another interface-specific unit. The pricing page shows tokvilo's rates in credits alongside their USD equivalent. Check that units match before comparing the numbers.", "A Playground quote applies to the current model and parameters. Review it again after changing the model, adding input or changing output specifications. It helps you decide whether to submit that request; it is not a fixed price for every future request."], list: ["Confirm the exact model ID and selected options.", "Check quantity, length, resolution and other parameters that affect the amount.", "Review the billing unit and request quote before confirming execution."] },
          { id: "reservation-and-settlement", title: "3. A reservation holds credits while a request is active", paragraphs: ["When a request is submitted, the system reserves the quoted credits. Other requests cannot spend that reserved balance again. Once the result and actual consumption are confirmed, the request is settled and releasable excess is returned.", `Here is a hypothetical example to explain the process, not a price for any model: a request reserves ${formatCreditsWithUsd(100_000, "en")} and its confirmed consumption is ${formatCreditsWithUsd(60_000, "en")}, so the remaining ${formatCreditsWithUsd(40_000, "en")} are released. Always use the original request's settlement record when checking a real charge.`], table: { headers: ["Stage", "What to check"], rows: [["Quote", "Current model, parameters, proposed credits and USD equivalent"], ["Reservation", "Original request ID and task status"], ["Settlement", "Confirmed consumption and released credits"], ["Adjustment", "The record linked to the original request or payment"]] } },
          { id: "when-a-request-is-pending", title: "4. Check the original request after a disconnection", paragraphs: ["A browser timeout means you did not receive a complete result over that connection. The request may still be processing or may need reconciliation. Submitting a new copy immediately can create two separate requests.", "Keep the original request ID and use the page's query or recovery action to check its status. Usage may remain reserved while the result is unconfirmed. Support can use that ID to inspect request and billing records.", "If you see an explicit insufficient-balance message, check your available usage and what other tasks have already reserved. A previous purchase does not mean the current available balance is enough for every request." ] },
          { id: "refunds-and-support", title: "5. Releasing usage and refunding payment are separate", paragraphs: ["Releasing a reservation restores available service usage. It does not send money back to a card or bank account. A payment refund requires a review of the purchase, delivery, consumption and applicable refund rules.", "Contact support about duplicate payments, a payment without allocation, undelivered service or a potentially incorrect charge. Provide your account email, transaction or bank reference, and relevant request IDs. Do not send passwords, API keys or full card details.", "Online purchases follow the applicable refund policy and non-waivable statutory rights. An approved refund adjusts the corresponding service usage. See the payment information and refund policy pages for the process." ] },
        ],
        cta: { title: "Understand payment before buying usage", description: "Review API usage packs, enterprise transfer arrangements, and payment and refund policies.", label: "Continue payment", href: "/billing" },
      },
    },
  },
];

export function getBlogPost(slug: string): BlogPost | undefined { return blogPosts.find(post => post.slug === slug); }
export function blogPath(locale: BlogLocale, slug?: string): string { return `${locale === "en" ? "/en" : ""}/blog${slug ? `/${slug}` : ""}`; }
export function blogCanonical(locale: BlogLocale, slug?: string): string { return `https://tokvilo.com${blogPath(locale, slug)}`; }
export function blogLink(locale: BlogLocale, path: string): string {
  if (locale === "zh") return path;
  return path.startsWith("/dashboard") || path.startsWith("/playground") ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : `/en${path === "/" ? "" : path}`;
}
export function blogDate(locale: BlogLocale, date: string): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

export function blogPageMetadata(locale: BlogLocale, post?: BlogPost): Metadata {
  const title = post?.content[locale].title || (locale === "en" ? "Blog — practical AI model guides" : "博客 · AI 模型使用指南");
  const description = post?.content[locale].description || (locale === "en" ? "Practical tokvilo guides to choosing AI models, making API requests and understanding usage and billing." : "tokvilo 原创使用指南：比较 AI 模型、开始 API 接入，理解报价、用量与账务。");
  const url = blogCanonical(locale, post?.slug);
  return {
    title, description, robots: { index: true, follow: true },
    alternates: { canonical: url, languages: { "zh-CN": blogCanonical("zh", post?.slug), en: blogCanonical("en", post?.slug), "x-default": blogCanonical("zh", post?.slug) } },
    openGraph: { type: post ? "article" : "website", title, description, url, siteName: "tokvilo", locale: locale === "en" ? "en_US" : "zh_CN", ...(post ? { publishedTime: `${post.date}T00:00:00Z`, modifiedTime: `${post.date}T00:00:00Z`, authors: [post.author] } : {}) },
    twitter: { card: "summary", title, description },
  };
}

export function blogStructuredData(locale: BlogLocale, post?: BlogPost) {
  const language = locale === "en" ? "en" : "zh-CN", url = blogCanonical(locale, post?.slug);
  const home = `https://tokvilo.com${locale === "en" ? "/en" : "/"}`;
  const breadcrumbs = [
    { "@type": "ListItem", position: 1, name: "tokvilo", item: home },
    { "@type": "ListItem", position: 2, name: locale === "en" ? "Blog" : "博客", item: blogCanonical(locale) },
    ...(post ? [{ "@type": "ListItem", position: 3, name: post.content[locale].title, item: url }] : []),
  ];
  return { "@context": "https://schema.org", "@graph": [
    { "@type": "BreadcrumbList", itemListElement: breadcrumbs },
    post ? {
      "@type": "BlogPosting", "@id": `${url}#article`, mainEntityOfPage: url, url,
      headline: post.content[locale].title, description: post.content[locale].description,
      datePublished: `${post.date}T00:00:00Z`, dateModified: `${post.date}T00:00:00Z`, inLanguage: language,
      author: { "@type": "Organization", name: post.author, url: "https://tokvilo.com" },
      publisher: { "@type": "Organization", name: "tokvilo", url: "https://tokvilo.com" },
      articleSection: post.content[locale].category,
    } : {
      "@type": "Blog", "@id": `${url}#blog`, url, name: locale === "en" ? "tokvilo Blog" : "tokvilo 博客", inLanguage: language,
      blogPost: blogPosts.map(item => ({ "@type": "BlogPosting", headline: item.content[locale].title, url: blogCanonical(locale, item.slug), datePublished: `${item.date}T00:00:00Z` })),
    },
  ] };
}
