"use client";

import { CREDIT_EXCHANGE_LABEL } from "@/lib/credits";

import Link from "next/link";
import { PublicNav } from "./PublicNav";
import { PublicFooter } from "./PublicFooter";
import { useSiteLocale } from "./LocaleProvider";

export type LegalDocument = "terms" | "refunds" | "privacy";
type Section = { id: string; title: [string, string]; paragraphs: [string, string][] };
const sections: Record<LegalDocument, Section[]> = {
  terms: [
    { id: "service", title: ["1. 服务提供者与服务范围", "1. Provider & services"], paragraphs: [
      ["tokvilo 由 BO 运营（BO，以 tokvilo 品牌运营）。我们提供模型目录、API 接入、Playground、账户与用量管理等软件服务。联系我们：yt.feng@foxmail.com，24 小时内回复。", "tokvilo is operated by BO (BO, operating as tokvilo). Our software includes a model catalogue, API access, Playground, account management and usage tracking. Contact yt.feng@foxmail.com; we reply within 24 hours."],
      ["模型由第三方模型基础设施处理，tokvilo 提供统一的软件访问与计费。厂商名称和标识用于识别相应模型，不表示 tokvilo 与这些厂商存在官方合作关系。", "Third-party model infrastructure processes model requests; tokvilo provides software access and billing. Model names and logos identify the relevant products and do not imply an official partnership with their creators."],
    ] },
    { id: "account", title: ["2. 账户与使用", "2. Accounts & use"], paragraphs: [
      ["请提供准确的注册和账单信息，妥善保管密码与 API 密钥，并仅使用你有权提交的内容。你应具有订立本服务合同所需的法定资格；代表企业购买时，应获得相应授权。", "Provide accurate account and billing information, protect your password and API keys, and submit only content you are entitled to use. You must have legal capacity to enter this agreement and authorization to purchase on behalf of a company."],
      ["不得利用本服务实施违法活动、欺诈、侵犯他人知识产权或隐私，或绕过服务限制。不得生成或传播未经授权的身份冒充、换脸、深度伪造、声音模仿或其他违反适用法律与模型服务规则的内容。", "Do not use the service for unlawful activity, fraud, intellectual property or privacy violations, or to circumvent service restrictions. Do not generate or distribute unauthorized impersonations, face swaps, deepfakes, voice imitations, or other content that violates applicable law or model service rules."],
    ] },
    { id: "payment", title: ["3. 价格、购买与用量", "3. Pricing, purchases & usage"], paragraphs: [
      [`API 积分是同一美元服务余额的显示单位：${CREDIT_EXCHANGE_LABEL.zh}。积分不改变所选模型的真实费率或 token 用量；页面与确认报价同时提供美元等值。数字商品独立计价。`, `API credits are a display unit for the same USD service balance: ${CREDIT_EXCHANGE_LABEL.en}. Credits do not change the selected model’s actual rates or token usage; pages and confirmed quotes also provide the USD equivalent. Digital goods are priced separately.`],
      ["模型页与报价展示 tokvilo 当前售价和计费单位。API 服务用量包为一次性购买，不自动续费。USD 20、50、100 用量包分别包含同等金额的 tokvilo 服务用量；适用税费另在收银台显示，不计入服务用量。", "Model pages and quotes show current tokvilo rates and billing units. API usage packs are one-time purchases without automatic renewal. USD 20, 50 and 100 packs include the corresponding amount of tokvilo service usage. Applicable taxes are shown separately at checkout and do not add usage."],
      ["Paddle 支付仅在本网站完成审核与配置后开放；经 Paddle 处理的购买同时适用收银台展示的 Paddle 买方条款。企业银行转账按邮件确认的服务和付款说明办理，核实实际到账后人工入账。", "Paddle payments become available after this website completes review and configuration. Purchases processed through Paddle are also subject to the Paddle buyer terms presented at checkout. Enterprise transfers follow the service and payment instructions confirmed by email, with usage added after receipt is verified."],
      ["服务用量仅用于购买账户的 tokvilo API 与 Playground，不可转赠、提现或用于第三方商品支付。第三方账户、会员订阅和代充商品不属于 API 用量包。退款按退款政策与适用法律办理。", "Usage is exclusively for the purchasing account's tokvilo APIs and Playground. It is non-transferable, cannot be cashed out and cannot pay for third-party goods. Third-party accounts, memberships and subscription top-ups are outside the API usage packs. Refunds are handled under our refund policy and applicable law."],
    ] },
    { id: "delivery", title: ["4. 交付与结果确认", "4. Delivery & confirmation"], paragraphs: [
      ["付款经服务端确认后将对应服务用量计入账户。API 请求提交前预留报价额度，实际用量确认后结算并释放剩余预留。结果不明的请求可能需要人工核对；请提供原请求编号，避免在未核对时重复提交。", "The corresponding usage is added after server-side payment verification. An API request reserves its quoted usage before submission, then settles confirmed usage and releases the remainder. An uncertain result may need reconciliation; provide the original request ID and check its status before submitting again."],
      ["模型能力、容量和可用性可能变化，生成结果也可能不准确或不符合预期。请根据使用场景核实结果。我们不保证指定模型永久提供、每次请求成功或生成结果适用于某项专业决策。服务未提供或付款异常时，可按退款政策联系处理。", "Model capabilities, capacity and availability may change, and generated content may be inaccurate or unsuitable. Review outputs for your intended use. We do not guarantee permanent access to a particular model, success for every request, or suitability for a professional decision. Contact us under the refund policy for undelivered service or payment problems."],
    ] },
    { id: "inquiries", title: ["5. 独立商品咨询", "5. Separate product inquiries"], paragraphs: [
      ["数字商品页的表单仅提交需求，不代表订单成立或已付款。我们在 24 小时内通过邮件回复适用条件与交付安排。这类咨询与 tokvilo API 软件用量购买分开处理，API 服务额度不能用于购买这些商品。", "Forms on the digital goods page submit an inquiry, not a paid order. We reply within 24 hours by email with eligibility and delivery details. These inquiries are handled separately from tokvilo API software usage purchases, and API service usage cannot be spent on these goods."],
    ] },
    { id: "rights", title: ["6. 服务变更与法定权利", "6. Changes & statutory rights"], paragraphs: [
      ["违反本条款、未授权使用或出现账务争议时，我们可能限制相关账户或请求，并保留必要的处理记录。条款更新会在本页显示日期；既有付款争议按该笔交易适用的条款和法律处理。", "We may restrict affected accounts or requests for breaches, unauthorized use or billing disputes, and retain records needed to address them. Updates show a date on this page. Existing payment disputes are handled under the terms and law applicable to that transaction."],
      ["本条款不限制法律赋予消费者的强制性权利。对本服务、账户或账务有疑问，请联系 yt.feng@foxmail.com，并提供相关账户邮箱与请求或交易编号。", "These terms do not limit mandatory consumer rights. For service, account or billing questions, contact yt.feng@foxmail.com with the account email and relevant request or transaction ID."],
    ] },
  ],
  refunds: [
    { id: "request", title: ["1. 如何申请", "1. How to request a review"], paragraphs: [
      ["请发送邮件至 yt.feng@foxmail.com，提供 tokvilo 注册邮箱、交易或银行流水编号、购买日期、希望处理的金额及原因。涉及 API 请求时请附请求编号。无需发送密码、API 密钥或完整银行卡信息。我们在 24 小时内回复。", "Email yt.feng@foxmail.com with your tokvilo account email, transaction or bank reference, purchase date, amount and reason. Include request IDs for API issues. Do not send passwords, API keys or full card details. We reply within 24 hours."],
      ["重复付款、付款成功但未增加用量、未提供的软件服务及疑似错误扣费均可申请核查。确认结果前，请保留原交易和请求编号。", "We review duplicate payments, successful payments without usage delivery, undelivered software services and potentially incorrect charges. Keep the original transaction and request IDs while the result is being checked."],
    ] },
    { id: "paddle", title: ["2. 在线购买", "2. Online purchases"], paragraphs: [
      ["通过 Paddle 处理的购买适用 Paddle 的退款政策和收银台展示的买方条款。你也可以直接通过 paddle.net 提交支付或退款问题。适用法律赋予的不可放弃权利优先适用。", "Purchases processed by Paddle are subject to Paddle's refund policy and the buyer terms shown at checkout. You may also contact paddle.net directly for payment or refund assistance. Non-waivable rights under applicable law take precedence."],
      ["我们会根据实际付款、服务是否提供、已消耗用量及适用权利核查未使用部分的申请。是否可退和可退金额以具体交易核查、Paddle 处理及适用法律为准；本页不作所有购买均可退或均不可退的承诺。", "We assess requests for unused usage against the amount actually paid, service delivery, consumption and applicable rights. Eligibility and amounts depend on the transaction review, Paddle's processing and applicable law; this page does not promise that every purchase is refundable or non-refundable."],
      ["退款获批后按原支付方式退回，并撤回与退款对应的服务用量。到账时间取决于支付机构。退还款项对应的用量不能继续使用；已消耗用量或其他账务争议由支持进一步核对。", "Approved refunds return through the original payment method, and the corresponding service usage is removed. Posting time depends on the payment provider. Refunded usage cannot continue to be used; support will review consumption or other billing discrepancies."],
    ] },
    { id: "bank", title: ["3. 企业银行转账", "3. Enterprise bank transfers"], paragraphs: [
      ["银行转账的服务范围、入账金额与付款说明通过邮件确认。退款申请由 BO 根据实际到账、服务交付、已使用额度、双方确认的约定及适用法律核对。若获批准，我们通过邮件确认退回安排，并同步调整对应服务用量。", "Bank transfer services, allocations and instructions are confirmed by email. BO reviews refund requests against the funds received, delivery, usage, agreed terms and applicable law. If approved, we confirm the return arrangements by email and adjust the corresponding service usage."],
    ] },
    { id: "pending", title: ["4. 请求预留与未确认状态", "4. Reserved usage & unconfirmed requests"], paragraphs: [
      ["API 调用中的预留额度不是另一笔现金付款。请求完成后按确认用量结算；可释放的剩余预留回到账户。网络中断或结果不明时可能暂时保留预留，等待原请求核对。预留释放与现金退款是不同流程。", "Reserved API usage is not another cash payment. Requests settle against confirmed usage, with releasable excess returned to the account. A network interruption or uncertain result may leave a reservation pending reconciliation. Releasing a reservation and refunding a payment are separate processes."],
    ] },
  ],
  privacy: [
    { id: "operator", title: ["1. 运营者与联系方式", "1. Operator & contact"], paragraphs: [
      ["BO，以 tokvilo 品牌运营，负责本网站及其账户、API 和支持功能涉及的信息处理。隐私问题、访问或删除申请请联系 yt.feng@foxmail.com。我们在 24 小时内回复，并可能先核实账户归属。", "BO, operating as tokvilo, is responsible for information processing associated with this website, its accounts, APIs and support. Contact yt.feng@foxmail.com for privacy questions or access and deletion requests. We reply within 24 hours and may first verify account ownership."],
    ] },
    { id: "data", title: ["2. 我们处理的信息", "2. Information we process"], paragraphs: [
      ["账户与身份信息包括邮箱、显示名称、认证和会话记录，以及注册、登录和找回密码所需的信息。账务记录包括订单与交易编号、服务额度、用量结算、退款或调整记录；企业转账和支持可能包含企业名称、付款参考编号及你提供的说明。", "Account information includes your email, display name, authentication and session records, and information needed for registration, sign-in and password recovery. Billing records include order and transaction IDs, service allocations, usage settlements, refunds and adjustments. Enterprise transfers and support may include company names, payment references and details you provide."],
      ["API 与 Playground 请求可能包含提示词、参数、你提交的图片或媒体引用，以及模型响应和结果链接。我们处理请求状态、错误信息、时间和计费用量等运行记录。部分任务与响应记录会保存，以便展示结果、恢复请求和核对账务。", "API and Playground requests may include prompts, parameters, images or media references you submit, and model responses or result links. We process operational records such as request status, errors, timestamps and billable usage. Some task and response records are stored to display results, recover requests and reconcile billing."],
      ["数字商品咨询会处理所选商品、联系人邮箱、姓名和需求说明，并发送至支持邮箱以便回复。请只提供处理咨询所必需的信息。", "Digital goods inquiries include the selected product, contact email, name and request details, which are sent to our support email for a reply. Provide only information needed to handle the inquiry."],
    ] },
    { id: "purpose", title: ["3. 处理目的与服务商", "3. Purposes & service providers"], paragraphs: [
      ["我们使用这些信息提供账户访问、执行模型请求、显示结果、计量服务、处理付款和退款、提供支持，以及调查异常和履行适用义务。依适用法律，相关依据可能包括履行合同、合法利益、法定义务及必要时取得的同意。", "We use this information to provide account access, execute model requests, display results, meter services, handle payments and refunds, provide support, investigate problems and meet applicable obligations. Depending on applicable law, processing may rely on contract performance, legitimate interests, legal obligations or consent where required."],
      ["云托管、数据库、认证、邮件和模型基础设施服务商会在提供相关功能所需范围内处理数据。提示词和输入内容会传送给执行所选模型请求的第三方基础设施；其处理和保留规则可能因模型而异，不应将本站理解为所有模型均零保留。", "Cloud hosting, database, authentication, email and model infrastructure providers process data needed for their functions. Prompts and inputs are sent to third-party infrastructure that executes the selected model. Processing and retention practices can vary by model; do not assume zero retention across all models."],
      ["通过 Paddle 付款时，支付资料由 Paddle 及相关支付机构处理；tokvilo 接收用于对账的交易状态、编号与账务信息，不保存完整支付卡号。跨境服务商可能在你所在国家以外处理数据；适用的保护和权利按相关服务及法律处理。", "When you pay through Paddle, Paddle and its payment providers process payment details. tokvilo receives transaction status, IDs and billing information for reconciliation and does not store full payment card numbers. International providers may process data outside your country; applicable safeguards and rights are handled under the relevant services and laws."],
    ] },
    { id: "storage", title: ["4. Cookie、本地存储与保留", "4. Cookies, local storage & retention"], paragraphs: [
      ["我们使用会话 Cookie 保持登录状态，并使用浏览器本地存储保存主题等界面偏好。禁用必要 Cookie 可能影响登录和控制台功能。", "We use session cookies to keep you signed in and browser local storage for interface preferences such as theme. Disabling necessary cookies may affect sign-in and dashboard features."],
      ["信息保留取决于提供服务、恢复请求、支持、账务核查及适用记录义务的需要。不同类别记录和服务商的周期可能不同；账户删除不必然同时删除仍需依法或为账务核对保留的记录。可联系支持了解具体请求的处理情况。", "Retention depends on service delivery, request recovery, support, reconciliation and applicable recordkeeping obligations. Periods may vary by record category and provider. Account deletion does not necessarily remove records still needed for legal or billing purposes. Contact support about your specific request."],
    ] },
    { id: "choices", title: ["5. 你的选择与申请", "5. Your choices & requests"], paragraphs: [
      ["请妥善保管登录信息和 API 密钥，不要在提示词或支持邮件中提交无权共享的信息。根据适用法律，你可申请访问、更正、删除、限制处理或提出异议；适用时也可撤回同意。请通过支持邮箱提出，我们会说明核实步骤和适用的处理安排。", "Protect your login details and API keys, and do not submit information you are not entitled to share in prompts or support messages. Under applicable law, you may request access, correction, deletion, restriction or object to processing, and withdraw consent where relevant. Email support and we will explain verification and applicable handling steps."],
      ["本政策更新时将在本页调整日期。重要变化将通过适当方式说明。", "Updates will change the date on this page. Material changes will be explained through an appropriate channel."],
    ] },
  ],
};

export function LegalPage({ document }: { document: LegalDocument }) {
  const { t, href, locale } = useSiteLocale();
  const titles: Record<LegalDocument, [string, string]> = { terms: ["服务条款", "Terms of service"], refunds: ["退款政策", "Refund policy"], privacy: ["隐私政策", "Privacy policy"] };
  return <div className="market-page" lang={locale}><PublicNav /><main className="billing-main legal-main">
    <header className="billing-intro"><span className="landing-eyebrow">TOKVILO / {document.toUpperCase()}</span><h1>{t(...titles[document])}</h1><p>{t("更新日期：2026 年 10 月 26 日", "Updated October 26, 2026")}</p></header>
    <div className="legal-layout"><aside className="legal-contents"><span>{t("本页内容", "On this page")}</span><nav aria-label={t("本页目录", "Page contents")}>{sections[document].map(section => <a href={`#${section.id}`} key={section.id}>{t(...section.title)}</a>)}</nav><Link href={href("/billing")}>{t("← 支付方式", "← Payment options")}</Link></aside><article className="legal-copy">{sections[document].map(section => <section id={section.id} key={section.id}><h2>{t(...section.title)}</h2>{section.paragraphs.map((paragraph, index) => <p key={index}>{t(...paragraph)}</p>)}{document === "refunds" && section.id === "paddle" ? <p className="legal-source-links"><a href="https://www.paddle.com/legal/refund-policy" target="_blank" rel="noreferrer">{t("支付服务商退款政策", "Payment provider refund policy")} ↗</a><a href="https://paddle.net" target="_blank" rel="noreferrer">{t("支付服务商买方支持", "Payment provider buyer support")} ↗</a></p> : null}{document === "terms" && section.id === "payment" ? <p><Link href={href("/refunds")}>{t("查看退款政策", "Read the refund policy")} ↗</Link></p> : null}</section>)}</article></div>
  </main><PublicFooter /></div>;
}
