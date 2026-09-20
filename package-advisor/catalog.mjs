// Client-facing service data. Only approved public fields are included.
export const catalog = [
  {
    "id": "W01",
    "name": "品牌／产品事实盘点",
    "unit": "项目",
    "price": 16500,
    "deliverables": [
      "1个品牌、最多5个产品族的事实卡",
      "主张与证据清单、缺口及公开范围",
      "2轮事实校准"
    ],
    "prerequisites": [
      "客户提供可核验的产品资料并确认公开范围"
    ],
    "category": "品牌与证据",
    "priority": 1,
    "goals": [
      "visibility",
      "content",
      "authority"
    ],
    "stages": [
      "starting",
      "growing"
    ]
  },
  {
    "id": "W02",
    "name": "业务／消费者深访",
    "unit": "场",
    "price": 4500,
    "deliverables": [
      "1场60–90分钟访谈",
      "转录整理和主题编码",
      "可用于内容建设的观点与事实线索"
    ],
    "prerequisites": [
      "客户安排受访者；外部受访者费用另列"
    ],
    "category": "品牌与证据",
    "priority": 3,
    "goals": [
      "content",
      "authority"
    ],
    "stages": [
      "starting",
      "growing",
      "established"
    ]
  },
  {
    "id": "W03",
    "name": "竞品与精选公开讨论研究",
    "unit": "批",
    "price": 12500,
    "deliverables": [
      "最多5个竞品的研究",
      "最多50条有效内容或评论人工编码",
      "来源链接和内容机会清单"
    ],
    "prerequisites": [
      "明确市场、产品及对照竞品"
    ],
    "category": "诊断与研究",
    "priority": 2,
    "goals": [
      "visibility",
      "content"
    ],
    "stages": [
      "starting",
      "growing",
      "established"
    ]
  },
  {
    "id": "W04",
    "name": "意图、场景与题库建模",
    "unit": "30题包",
    "price": 8500,
    "deliverables": [
      "最多30条去重意图问题",
      "角色、场景、购买阶段与证据映射",
      "版本化题库；回答采样单列"
    ],
    "prerequisites": [
      "客户确认目标市场、产品事实与采购或消费场景"
    ],
    "category": "诊断与研究",
    "priority": 1,
    "goals": [
      "visibility",
      "content",
      "authority"
    ],
    "stages": [
      "starting",
      "growing",
      "established"
    ]
  },
  {
    "id": "W05",
    "name": "定位与内容路线图",
    "unit": "项目",
    "price": 11000,
    "deliverables": [
      "1个品牌、5个主题的内容方向",
      "消息与证据矩阵",
      "90天内容优先级与路线图"
    ],
    "prerequisites": [
      "已有经核验的品牌事实或已完成W01"
    ],
    "category": "品牌与证据",
    "priority": 2,
    "goals": [
      "visibility",
      "content",
      "authority"
    ],
    "stages": [
      "starting",
      "growing",
      "established"
    ]
  },
  {
    "id": "W06",
    "name": "官网技术与知识架构轻量实施",
    "unit": "轻量实施包",
    "price": 41500,
    "deliverables": [
      "现有网站的轻量技术实施",
      "可读正文、索引配置、模板内链和适用结构化数据",
      "按事前确认清单验收；整站重建另行确定"
    ],
    "prerequisites": [
      "已有可编辑CMS；先确认模板和修复清单"
    ],
    "category": "官网与转化",
    "priority": 3,
    "goals": [
      "visibility",
      "content"
    ],
    "stages": [
      "starting",
      "growing",
      "established"
    ]
  },
  {
    "id": "W07",
    "name": "核心企业／产品／场景页面",
    "unit": "页",
    "price": 6000,
    "deliverables": [
      "1个独立URL的企业、产品或场景页面",
      "500–1000英文词或同等中文信息量，含证据、FAQ和CTA",
      "现有CMS上稿及2轮修改"
    ],
    "prerequisites": [
      "已有可编辑CMS与经确认的产品事实"
    ],
    "category": "内容资产",
    "priority": 1,
    "goals": [
      "content",
      "visibility"
    ],
    "stages": [
      "starting",
      "growing",
      "established"
    ]
  },
  {
    "id": "W08",
    "name": "研究型母文／技术Blog",
    "unit": "篇",
    "price": 6500,
    "deliverables": [
      "1篇800–1400英文词或同等中文深度的研究型文章",
      "来源核对与编辑审校",
      "2轮修改及现有CMS发布"
    ],
    "prerequisites": [
      "客户提供资料并安排专家确认技术事实；已有可编辑CMS"
    ],
    "category": "内容资产",
    "priority": 1,
    "goals": [
      "content",
      "visibility",
      "authority"
    ],
    "stages": [
      "starting",
      "growing",
      "established"
    ]
  },
  {
    "id": "W09",
    "name": "真实案例／选型比较资产",
    "unit": "份",
    "price": 10000,
    "deliverables": [
      "1个真实项目案例或最多4个方案的比较",
      "1次访谈或资料核对及1张图",
      "2轮修改和现有CMS发布"
    ],
    "prerequisites": [
      "有真实案例材料或可核验的方案资料"
    ],
    "category": "内容资产",
    "priority": 2,
    "goals": [
      "content",
      "authority"
    ],
    "stages": [
      "growing",
      "established"
    ]
  },
  {
    "id": "W10",
    "name": "渠道适配与上稿",
    "unit": "3条包",
    "price": 3000,
    "deliverables": [
      "3条实质渠道适配或专业社交短帖",
      "基于已确认的母内容复用",
      "客户自有渠道上稿；第三方媒介另列"
    ],
    "prerequisites": [
      "已有合格母内容；客户开放自有渠道权限"
    ],
    "category": "内容分发",
    "priority": 1,
    "goals": [
      "content",
      "visibility",
      "authority"
    ],
    "stages": [
      "starting",
      "growing",
      "established"
    ]
  },
  {
    "id": "W11",
    "name": "PDF／技术文档可读化",
    "unit": "文档",
    "price": 5500,
    "deliverables": [
      "将1份已有文档转为1个HTML关键内容页",
      "版本说明、下载入口与相关链接",
      "同一页面复用内容不重复收取原创费用"
    ],
    "prerequisites": [
      "已有不超过15页的技术资料和可编辑网站"
    ],
    "category": "官网与转化",
    "priority": 2,
    "goals": [
      "content",
      "visibility"
    ],
    "stages": [
      "growing",
      "established"
    ]
  },
  {
    "id": "W12",
    "name": "LinkedIn／企业资料主页设置",
    "unit": "页",
    "price": 5500,
    "deliverables": [
      "1个公司主页的英文资料",
      "封面、CTA与UTM设置",
      "后续资料维护规范"
    ],
    "prerequisites": [
      "客户提供品牌素材并开放公司主页权限"
    ],
    "category": "内容分发",
    "priority": 3,
    "goals": [
      "content",
      "authority"
    ],
    "stages": [
      "starting",
      "growing"
    ]
  },
  {
    "id": "W13",
    "name": "视频演示可发现性优化",
    "unit": "条",
    "price": 5500,
    "deliverables": [
      "1条视频的标题、字幕与转录",
      "视频说明和现有模板观看页",
      "拍摄制作另行确定"
    ],
    "prerequisites": [
      "已有不超过10分钟的视频和可编辑网站模板"
    ],
    "category": "内容分发",
    "priority": 3,
    "goals": [
      "content",
      "visibility"
    ],
    "stages": [
      "growing",
      "established"
    ]
  },
  {
    "id": "W14",
    "name": "社区／真实评价运营",
    "unit": "季度包",
    "price": 10000,
    "deliverables": [
      "季度内选择一个方向：2个社区12条专业答复，或5个客户反馈流程与回复",
      "内容与提交记录",
      "平台审核状态记录"
    ],
    "prerequisites": [
      "真实身份、可核验材料和适用社区权限"
    ],
    "category": "内容分发",
    "priority": 3,
    "goals": [
      "authority",
      "visibility"
    ],
    "stages": [
      "growing",
      "established"
    ]
  },
  {
    "id": "W15",
    "name": "白皮书整合与制作",
    "unit": "份",
    "price": 26500,
    "deliverables": [
      "8–12页白皮书",
      "2次访谈和2轮修改",
      "可编辑文件及PDF"
    ],
    "prerequisites": [
      "已有证据和可安排的专家；复用素材先核对"
    ],
    "category": "权威与研究",
    "priority": 3,
    "goals": [
      "authority",
      "content"
    ],
    "stages": [
      "growing",
      "established"
    ]
  },
  {
    "id": "W16",
    "name": "原创数据／测试研究解读",
    "unit": "项",
    "price": 28000,
    "deliverables": [
      "围绕1个研究问题的方法与解读",
      "最多5张图及研究稿",
      "实际实验与数据采购另行确定"
    ],
    "prerequisites": [
      "客户提供可核验的原始数据及使用权限"
    ],
    "category": "权威与研究",
    "priority": 3,
    "goals": [
      "authority"
    ],
    "stages": [
      "established"
    ]
  },
  {
    "id": "W17",
    "name": "伙伴联合案例与协调",
    "unit": "项",
    "price": 9000,
    "deliverables": [
      "1份伙伴联合内容",
      "最多2方审校协调",
      "本方发布；伙伴刊登条件另列"
    ],
    "prerequisites": [
      "已有真实伙伴及可公开的合作事实"
    ],
    "category": "权威与研究",
    "priority": 3,
    "goals": [
      "authority"
    ],
    "stages": [
      "growing",
      "established"
    ]
  },
  {
    "id": "W18",
    "name": "行业目录／协会／门店资料",
    "unit": "3条包",
    "price": 5000,
    "deliverables": [
      "3项行业目录、协会或门店资料更新/提交",
      "按一个方向组织资料",
      "提交与审核状态记录；会员费另列"
    ],
    "prerequisites": [
      "客户具备真实资料和相关资格"
    ],
    "category": "内容分发",
    "priority": 3,
    "goals": [
      "visibility",
      "authority"
    ],
    "stages": [
      "starting",
      "growing",
      "established"
    ]
  },
  {
    "id": "W19",
    "name": "SKU／购买与询盘路径校准",
    "unit": "10SKU包",
    "price": 11000,
    "deliverables": [
      "最多10个SKU的事实与可售状态校准",
      "1条购买或询盘路径校准",
      "现有系统内配置和事件测试"
    ],
    "prerequisites": [
      "已有购买或询盘系统并开放配置权限"
    ],
    "category": "官网与转化",
    "priority": 2,
    "goals": [
      "content",
      "visibility"
    ],
    "stages": [
      "growing",
      "established"
    ]
  },
  {
    "id": "W20",
    "name": "多语言内容适配",
    "unit": "5资产包",
    "price": 18000,
    "deliverables": [
      "1种已确认可审校语种的5项内容适配",
      "每项原文不超过1000词",
      "本地化审校；新增研究另列"
    ],
    "prerequisites": [
      "原文已完成并确认目标语言的审校条件"
    ],
    "category": "内容分发",
    "priority": 3,
    "goals": [
      "content",
      "authority"
    ],
    "stages": [
      "growing",
      "established"
    ]
  },
  {
    "id": "W21",
    "name": "团队培训与交接",
    "unit": "半天",
    "price": 10000,
    "deliverables": [
      "半天培训、案例与讲师资料",
      "人工审核规范",
      "交接清单；差旅另列"
    ],
    "prerequisites": [
      "确认参训对象和可使用的案例资料"
    ],
    "category": "团队与交接",
    "priority": 3,
    "goals": [
      "content",
      "authority",
      "visibility"
    ],
    "stages": [
      "starting",
      "growing",
      "established"
    ]
  },
  {
    "id": "W22",
    "name": "月度项目与内容统筹",
    "unit": "月",
    "price": 3500,
    "deliverables": [
      "月度执行排期与客户审校协调",
      "内容与来源资产台账",
      "下阶段行动清单；监测分析已在监测服务中列明"
    ],
    "prerequisites": [
      "客户指定业务及技术审校负责人"
    ],
    "category": "项目统筹",
    "priority": 2,
    "goals": [
      "visibility",
      "content",
      "authority"
    ],
    "stages": [
      "starting",
      "growing",
      "established"
    ]
  },
  {
    "id": "W23",
    "name": "知识中心／观测看板适配",
    "unit": "页面配置包",
    "price": 18000,
    "deliverables": [
      "配置1个基础知识中心页面或观测看板",
      "约定数据的展示与交接",
      "新采样和SaaS产品开发另行确定"
    ],
    "prerequisites": [
      "已有数据、可用组件及部署权限"
    ],
    "category": "官网与转化",
    "priority": 3,
    "goals": [
      "visibility"
    ],
    "stages": [
      "growing",
      "established"
    ]
  },
  {
    "id": "W24",
    "name": "API／Agent／客服接口原型",
    "unit": "接口原型包",
    "price": 54000,
    "deliverables": [
      "1个小型API、Agent或客服接口原型",
      "按确认用例演示与交接",
      "复杂交易和生产系统全面集成另行确定"
    ],
    "prerequisites": [
      "客户确认1个明确接口、数据权限和验收用例"
    ],
    "category": "官网与转化",
    "priority": 4,
    "goals": [
      "content"
    ],
    "stages": [
      "established"
    ]
  },
  {
    "id": "W25",
    "name": "事实纠错／旧内容更新",
    "unit": "5页包",
    "price": 8500,
    "deliverables": [
      "最多5个已有URL的事实纠错或旧内容更新",
      "每页正文改写不超过40%",
      "来源、版本及前后差异记录"
    ],
    "prerequisites": [
      "已有URL、原内容和经确认的更新事实"
    ],
    "category": "内容资产",
    "priority": 2,
    "goals": [
      "visibility",
      "content"
    ],
    "stages": [
      "growing",
      "established"
    ]
  },
  {
    "id": "W26",
    "name": "技术Webinar策划与复用",
    "unit": "场",
    "price": 18500,
    "deliverables": [
      "1场45分钟Webinar的策划",
      "20页以内资料与1次彩排",
      "问答摘要；平台及获客费用另列"
    ],
    "prerequisites": [
      "已有讲者、素材及活动平台"
    ],
    "category": "权威与研究",
    "priority": 3,
    "goals": [
      "authority",
      "content"
    ],
    "stages": [
      "growing",
      "established"
    ]
  },
  {
    "id": "W27",
    "name": "选型计算器／产品工具",
    "unit": "个",
    "price": 45000,
    "deliverables": [
      "1个产品选型工具或计算器",
      "最多8个输入、1套规则和1个结果页",
      "无后台数据库或物理仿真"
    ],
    "prerequisites": [
      "客户确认计算公式或选型规则"
    ],
    "category": "官网与转化",
    "priority": 4,
    "goals": [
      "content"
    ],
    "stages": [
      "established"
    ]
  },
  {
    "id": "W28",
    "name": "AI引用来源深审与证据地图",
    "unit": "20URL包",
    "price": 11500,
    "deliverables": [
      "20个去重AI引用来源人工深审",
      "来源身份、主题、时效、证据与品牌提及核对",
      "证据地图及内容机会；基础引用清单已含在监测中"
    ],
    "prerequisites": [
      "已有来源URL清单；可复用已获取的公开正文"
    ],
    "category": "诊断与研究",
    "priority": 2,
    "goals": [
      "visibility",
      "authority"
    ],
    "stages": [
      "growing",
      "established"
    ]
  },
  {
    "id": "W29",
    "name": "引用来源全文取证与归档",
    "unit": "200URL包",
    "price": 7500,
    "deliverables": [
      "200个去重公开URL的一次采集与最多一次允许的重试",
      "可获取正文、元数据、采集时间、状态及快照索引",
      "最多20条异常人工复核；有效正文数量依实际可获取状态记录"
    ],
    "prerequisites": [
      "已有获准工具和明确的公开目标URL清单"
    ],
    "category": "诊断与研究",
    "priority": 3,
    "goals": [
      "visibility"
    ],
    "stages": [
      "growing",
      "established"
    ]
  },
  {
    "id": "W30",
    "name": "竞品SKU与跨渠道价盘研究",
    "unit": "20SKU包",
    "price": 14000,
    "deliverables": [
      "最多5竞品、20个SKU、3个渠道的价盘研究",
      "规格、净含量、常价、促销价及可售状态核对",
      "带采样日期的可比价盘和价格带"
    ],
    "prerequisites": [
      "确认对照竞品、SKU和渠道范围"
    ],
    "category": "诊断与研究",
    "priority": 3,
    "goals": [
      "content",
      "authority"
    ],
    "stages": [
      "growing",
      "established"
    ]
  },
  {
    "id": "W31",
    "name": "单店消费者旅程与体验核验",
    "unit": "半日",
    "price": 7500,
    "deliverables": [
      "单店半日、最多8个触点的现场观察",
      "消费者旅程问题证据",
      "改善优先级；整改实施另行确定"
    ],
    "prerequisites": [
      "明确1家门店及允许观察的范围；差旅和购买费用另列"
    ],
    "category": "诊断与研究",
    "priority": 4,
    "goals": [
      "content"
    ],
    "stages": [
      "growing",
      "established"
    ]
  },
  {
    "id": "MON_BASE_15",
    "name": "15题AI可见度基线诊断",
    "unit": "次基线",
    "price": 7000,
    "deliverables": [
      "15道固定问题 × 3个实际可用平台 × 1轮，每题每轮1次",
      "45份计划回答观察及缺失状态台账",
      "原回答证据、原生引用清单、分平台分析与下一步建议"
    ],
    "prerequisites": [
      "已有客户确认的题库与品牌事实；新增题库建模可选W04",
      "平台、语言、地区和访问方式事前确认"
    ],
    "category": "AI观测与复盘",
    "priority": 1,
    "goals": [
      "visibility",
      "content",
      "authority"
    ],
    "stages": [
      "starting",
      "growing",
      "established"
    ],
    "sampling": {
      "questions": 15,
      "anchorQuestions": 0,
      "platforms": 3,
      "repeats": 1,
      "baselineRounds": 1,
      "fullFollowupRounds": 0,
      "lightRounds": 0,
      "plannedAnswers": 45
    }
  },
  {
    "id": "MON_90_15",
    "name": "15题AI可见度基线与复测",
    "unit": "90天验证周期",
    "price": 15500,
    "deliverables": [
      "15道固定问题 × 3个实际可用平台 × 2轮，每题每轮1次",
      "90份计划回答观察及缺失状态台账",
      "原回答证据、原生引用清单、分平台分析与下一步建议"
    ],
    "prerequisites": [
      "已有客户确认的题库与品牌事实；新增题库建模可选W04",
      "平台、语言、地区和访问方式事前确认"
    ],
    "category": "AI观测与复盘",
    "priority": 1,
    "goals": [
      "visibility",
      "content",
      "authority"
    ],
    "stages": [
      "starting",
      "growing",
      "established"
    ],
    "sampling": {
      "questions": 15,
      "anchorQuestions": 0,
      "platforms": 3,
      "repeats": 1,
      "baselineRounds": 1,
      "fullFollowupRounds": 1,
      "lightRounds": 0,
      "plannedAnswers": 90
    }
  },
  {
    "id": "MON_BASE_30",
    "name": "30题AI可见度基线诊断",
    "unit": "次基线",
    "price": 8500,
    "deliverables": [
      "30道固定问题 × 3个实际可用平台 × 1轮，每题每轮1次",
      "90份计划回答观察及缺失状态台账",
      "原回答证据、原生引用清单、分平台分析与下一步建议"
    ],
    "prerequisites": [
      "已有客户确认的题库与品牌事实；新增题库建模可选W04",
      "平台、语言、地区和访问方式事前确认"
    ],
    "category": "AI观测与复盘",
    "priority": 1,
    "goals": [
      "visibility",
      "content",
      "authority"
    ],
    "stages": [
      "starting",
      "growing",
      "established"
    ],
    "sampling": {
      "questions": 30,
      "anchorQuestions": 0,
      "platforms": 3,
      "repeats": 1,
      "baselineRounds": 1,
      "fullFollowupRounds": 0,
      "lightRounds": 0,
      "plannedAnswers": 90
    }
  },
  {
    "id": "MON_90_30",
    "name": "30题AI可见度基线与复测",
    "unit": "90天验证周期",
    "price": 19000,
    "deliverables": [
      "30道固定问题 × 3个实际可用平台 × 2轮，每题每轮1次",
      "180份计划回答观察及缺失状态台账",
      "原回答证据、原生引用清单、分平台分析与下一步建议"
    ],
    "prerequisites": [
      "已有客户确认的题库与品牌事实；新增题库建模可选W04",
      "平台、语言、地区和访问方式事前确认"
    ],
    "category": "AI观测与复盘",
    "priority": 1,
    "goals": [
      "visibility",
      "content",
      "authority"
    ],
    "stages": [
      "starting",
      "growing",
      "established"
    ],
    "sampling": {
      "questions": 30,
      "anchorQuestions": 0,
      "platforms": 3,
      "repeats": 1,
      "baselineRounds": 1,
      "fullFollowupRounds": 1,
      "lightRounds": 0,
      "plannedAnswers": 180
    }
  },
  {
    "id": "MON_BASE_60",
    "name": "60题AI可见度基线诊断",
    "unit": "次基线",
    "price": 11500,
    "deliverables": [
      "60道固定问题 × 3个实际可用平台 × 1轮，每题每轮1次",
      "180份计划回答观察及缺失状态台账",
      "原回答证据、原生引用清单、分平台分析与下一步建议"
    ],
    "prerequisites": [
      "已有客户确认的题库与品牌事实；新增题库建模可选W04",
      "平台、语言、地区和访问方式事前确认"
    ],
    "category": "AI观测与复盘",
    "priority": 1,
    "goals": [
      "visibility",
      "content",
      "authority"
    ],
    "stages": [
      "starting",
      "growing",
      "established"
    ],
    "sampling": {
      "questions": 60,
      "anchorQuestions": 0,
      "platforms": 3,
      "repeats": 1,
      "baselineRounds": 1,
      "fullFollowupRounds": 0,
      "lightRounds": 0,
      "plannedAnswers": 180
    }
  },
  {
    "id": "MON_90_60",
    "name": "60题AI可见度基线与复测",
    "unit": "90天验证周期",
    "price": 25000,
    "deliverables": [
      "60道固定问题 × 3个实际可用平台 × 2轮，每题每轮1次",
      "360份计划回答观察及缺失状态台账",
      "原回答证据、原生引用清单、分平台分析与下一步建议"
    ],
    "prerequisites": [
      "已有客户确认的题库与品牌事实；新增题库建模可选W04",
      "平台、语言、地区和访问方式事前确认"
    ],
    "category": "AI观测与复盘",
    "priority": 1,
    "goals": [
      "visibility",
      "content",
      "authority"
    ],
    "stages": [
      "starting",
      "growing",
      "established"
    ],
    "sampling": {
      "questions": 60,
      "anchorQuestions": 0,
      "platforms": 3,
      "repeats": 1,
      "baselineRounds": 1,
      "fullFollowupRounds": 1,
      "lightRounds": 0,
      "plannedAnswers": 360
    }
  },
  {
    "id": "MON_BASE_90",
    "name": "90题AI可见度基线诊断",
    "unit": "次基线",
    "price": 15000,
    "deliverables": [
      "90道固定问题 × 3个实际可用平台 × 1轮，每题每轮1次",
      "270份计划回答观察及缺失状态台账",
      "原回答证据、原生引用清单、分平台分析与下一步建议"
    ],
    "prerequisites": [
      "已有客户确认的题库与品牌事实；新增题库建模可选W04",
      "平台、语言、地区和访问方式事前确认"
    ],
    "category": "AI观测与复盘",
    "priority": 1,
    "goals": [
      "visibility",
      "content",
      "authority"
    ],
    "stages": [
      "starting",
      "growing",
      "established"
    ],
    "sampling": {
      "questions": 90,
      "anchorQuestions": 0,
      "platforms": 3,
      "repeats": 1,
      "baselineRounds": 1,
      "fullFollowupRounds": 0,
      "lightRounds": 0,
      "plannedAnswers": 270
    }
  },
  {
    "id": "MON_90_90",
    "name": "90题AI可见度基线与复测",
    "unit": "90天验证周期",
    "price": 31500,
    "deliverables": [
      "90道固定问题 × 3个实际可用平台 × 2轮，每题每轮1次",
      "540份计划回答观察及缺失状态台账",
      "原回答证据、原生引用清单、分平台分析与下一步建议"
    ],
    "prerequisites": [
      "已有客户确认的题库与品牌事实；新增题库建模可选W04",
      "平台、语言、地区和访问方式事前确认"
    ],
    "category": "AI观测与复盘",
    "priority": 1,
    "goals": [
      "visibility",
      "content",
      "authority"
    ],
    "stages": [
      "starting",
      "growing",
      "established"
    ],
    "sampling": {
      "questions": 90,
      "anchorQuestions": 0,
      "platforms": 3,
      "repeats": 1,
      "baselineRounds": 1,
      "fullFollowupRounds": 1,
      "lightRounds": 0,
      "plannedAnswers": 540
    }
  },
  {
    "id": "PITCH_SETUP",
    "name": "行业PR首次资料与方法设置",
    "unit": "次",
    "price": 8000,
    "deliverables": [
      "事实与发言人范围确认",
      "媒体资料包清单与匹配规则",
      "采访流程与沟通模板"
    ],
    "prerequisites": [
      "已有可公开的新闻证据和客户授权发言人",
      "与PITCH配套；同一项目首次收取"
    ],
    "category": "权威与研究",
    "priority": 3,
    "goals": [
      "authority"
    ],
    "stages": [
      "growing",
      "established"
    ]
  },
  {
    "id": "PITCH",
    "name": "行业PR策划与编辑沟通",
    "unit": "传播项目",
    "price": 28500,
    "deliverables": [
      "1个新闻角度与12个媒体/记者匹配目标",
      "12封个性化pitch及适合对象最多2轮跟进",
      "采访协调、真实沟通日志和复盘"
    ],
    "prerequisites": [
      "已完成PITCH_SETUP或有可复用的合格资料与流程",
      "以策划与沟通交付验收，编辑自主决定是否刊登"
    ],
    "category": "权威与研究",
    "priority": 3,
    "goals": [
      "authority"
    ],
    "stages": [
      "growing",
      "established"
    ]
  }
];

export const advisorConfig = {
  "currency": "CNY",
  "taxBasis": "未税",
  "priceLabel": "参考服务价",
  "budgetMin": 5000,
  "budgetMax": null,
  "budgetStep": 5000,
  "defaultBudget": 80000,
  "periodDays": 90,
  "defaultLanguage": "英语",
  "goals": [
    {
      "id": "visibility",
      "label": "提升AI可见度"
    },
    {
      "id": "content",
      "label": "建立内容与询盘基础"
    },
    {
      "id": "authority",
      "label": "积累行业权威与信任"
    }
  ],
  "stages": [
    {
      "id": "starting",
      "label": "准备出海，基础待建立"
    },
    {
      "id": "growing",
      "label": "已有官网，内容需要增长"
    },
    {
      "id": "established",
      "label": "已有积累，扩大行业影响"
    }
  ],
  "conditions": [
    "推荐为范围明确的参考服务组合，最终数量、语言和交付排期经确认后形成正式报价。",
    "参考服务价不含税；媒体发布、会员、差旅等第三方项目按确认报价另列。",
    "AI回答和媒体刊登由第三方决定；以可核对的服务成果、原始证据与复测记录验收。",
    "客户已有合格资产可核验复用；先确认事实、素材、权限和审校负责人。"
  ],
  "comparisonBasis": "以相同服务范围、交付数量、语言、修改轮次和验收证据比较方案。"
};

export const pricingPrinciples = [
  {
    "title": "按交付清单定价",
    "description": "把研究、内容、发布和复测拆成可核对的范围与数量。预算先投向本阶段最需要的成果。"
  },
  {
    "title": "已有资产，先复用",
    "description": "已有合格官网、题库、资料和内容可接入项目，核验后优先更新与复用。"
  },
  {
    "title": "一份原创，多处使用",
    "description": "母内容只计一次原创费用，后续渠道适配按增量工作收费；同一次访谈、同一URL制作不重复计费。"
  },
  {
    "title": "不绑定年度大包",
    "description": "可以先做诊断或90天验证，看到交付与观测结果后再决定下一阶段。"
  },
  {
    "title": "监测自带证据和分析",
    "description": "约定监测包含原回答证据、引用清单、缺失记录与分析。额外看板定制按需要选择。"
  },
  {
    "title": "外部费用单独列明",
    "description": "媒体发布、会员、差旅等按确认项目另列；已计费母稿不在采购环节重复收取原创费用。"
  }
];

export default catalog;


export const INTENT_DEFINITION = '意图是独立、去重的采购或消费决策主题；同义问法、语句改写不重复计数。意图数是全项目总量，不是平台回答条数或文章数量。';
export const CN_UNIT_PRICE = 50000;
export const CN_UNIT_SCOPE = { productLines: 1, scenarios: 3, audiences: 3, intents: 30 };

const cnQuarter = {
  id: 'CN_QUARTER', name: '中文 GEO 季度标准单元', unit: '季度标准单元', price: CN_UNIT_PRICE,
  deliverables: [
    '每单元覆盖1条产品线、最多3个场景、最多3类客群的季度服务范围',
    '每单元按30个去重决策主题规划；全项目意图总量与范围单元取较大值，不重复叠加收费',
    '去重决策主题与问法清单，以及场景、客群和决策阶段映射',
    '品牌事实与证据缺口、内容行动清单，形成后续可复用资料',
    '季度执行记录与复盘，以及下一季度优先级',
    '原创篇数、发布数量、观测平台和轮次在启动清单中确认；范围矩阵不等于文章或发布数量',
  ],
  prerequisites: ['客户确认产品线、场景、客群及去重意图范围，提供可核验资料与审校负责人'],
  category: '中文季度服务', priority: 1, goals: ['visibility', 'content', 'authority'], stages: ['starting', 'growing', 'established'],
  market: 'cn', pricingStatus: 'priced', optional: false, maxQuantity: 115600,
};

// Chinese extensions have independently confirmed scopes and quotations.
// Overseas unit prices never determine a Chinese extension's price.
const cnScopeDescriptions = {
  W01: '整理品牌与产品事实、主张证据、资料缺口和公开范围。',
  W02: '围绕业务与客户决策进行访谈、记录整理和主题编码。',
  W03: '研究竞品及精选公开讨论，核对来源并形成有限范围洞察。',
  W04: '建立去重决策主题与问题框架，映射场景、客群、阶段和证据。',
  W05: '结合现有事实与研究，形成定位、内容方向和阶段优先级。',
  W06: '按现有网站条件确定可读正文、索引、内链和知识架构修复清单。',
  W07: '制作企业、产品或场景页面，组织事实、证据、问答与行动入口。',
  W08: '制作研究型内容，完成来源核对、结构编辑与客户事实审校。',
  W09: '基于真实材料制作案例或选型比较，核对证据与公开权限。',
  W10: '将已有合格母稿适配到确认的渠道，按增量制作与提交范围交付。',
  W11: '将已有技术资料整理为可阅读和可检索的网页内容。',
  W12: '按所选渠道建设企业资料主页、品牌信息和联络入口。',
  W13: '优化现有视频的标题、字幕、转录和说明，拍摄另行确定。',
  W14: '以真实身份开展专业社区答复或客户反馈流程建设，记录审核状态。',
  W15: '整合经核准证据与访谈材料，完成白皮书的结构、编辑和审校。',
  W16: '解读客户获准使用的数据或测试结果，形成方法、图表和研究结论。',
  W17: '基于真实伙伴合作组织联合内容、审校协调与约定发布。',
  W18: '更新或提交真实有效的行业目录、协会或门店资料。',
  W19: '核对产品资料、可售状态及购买或询盘路径，确定事件验证方式。',
  W20: '按确认的语种和审校条件开展内容本地化，原文及新增研究分开确认。',
  W21: '根据参训对象配置课程、案例、审核规范与交接内容。',
  W22: '仅针对超出季度基包范围的额外团队、额外审批链或专项协作配置统筹；基础排期与季度复盘不重复收费。',
  W23: '根据已有数据与组件配置知识中心页面或观测看板。',
  W24: '按明确接口、数据权限和验收用例制作小型系统原型。',
  W25: '核验并修订已有内容中的事实，记录来源、版本和变更。',
  W26: '围绕现有讲者与素材策划活动、资料、彩排和问答复用。',
  W27: '按客户确认的选型规则或公式配置产品工具及结果展示。',
  W28: '人工深审已取得的AI引用来源，核对证据、品牌提及和内容机会。',
  W29: '使用获准工具归档公开来源正文、元数据、时间与获取状态。',
  W30: '按确认的竞品、产品与渠道范围核对规格、价格和可售状态。',
  W31: '按获准门店与触点范围观察消费者旅程，记录问题证据与优先级。',
  PITCH_SETUP: '确认事实、发言人、资料包、媒体匹配规则和沟通流程。',
  PITCH: '进行新闻角度研究、媒体匹配、个性化沟通和过程复盘；刊登由编辑决定。',
};

export const cnCatalog = [cnQuarter, ...catalog.filter(item => !item.sampling && item.id !== 'W04').map(item => ({
  id: `CN_${item.id}`, name: item.id === 'W22' ? '中文 · 超出基包的多团队项目统筹' : `中文 · ${item.name}`, unit: item.unit,
  price: null, deliverables: [cnScopeDescriptions[item.id], '具体数量、平台、研究深度与审校轮次随中文增项范围确认', '交付对应成果、来源或执行记录，并完成约定交接'],
  prerequisites: ['客户提供真实资料、所需权限及审校负责人', '与中文季度基包核对重叠范围，增量服务单独核价，不套用境外单价'],
  category: item.category, priority: item.priority, goals: [...item.goals], stages: [...item.stages],
  market: 'cn', pricingStatus: 'quote_required', optional: true,
  maxQuantity: item.id === 'PITCH_SETUP' ? 1 : 100,
})), {
  id: 'CN_AI_OBSERVATION', name: '中文 · AI回答观测与分析增项', unit: '增项范围', price: null,
  deliverables: ['按中文增项需求确认实际平台、去重题库、采样协议、基线与复测安排', '交付约定的原回答证据、引用、缺失状态和分析', '具体题数、平台数、轮次与观察量另行确认；此项不是社交聆听'],
  prerequisites: ['先核对中文季度基包中已约定的观测范围，避免重复收费', '客户确认题库和可核验品牌事实'],
  category: 'AI观测与复盘', priority: 2, goals: ['visibility', 'content', 'authority'], stages: ['starting', 'growing', 'established'],
  market: 'cn', pricingStatus: 'quote_required', optional: true, maxQuantity: 100,
}];

export const socialListeningService = {
  id: 'SOCIAL_LISTENING', name: '定制 Social Listening 社交聆听', unit: '定制项目', price: null,
  deliverables: ['按平台、研究深度、监测频率、市场与语种确定采集和分析范围', '另行确认历史覆盖、可取得的数据、主题或品牌识别口径与报告交付', '告警规则、响应安排及外部数据费用按实际需求核价'],
  prerequisites: ['平台授权与数据可取得性需要确认', 'AI回答采样和一次性精选讨论研究均不替代持续社交聆听'],
  category: '定制社交聆听', priority: 2, goals: ['visibility', 'content', 'authority'], stages: ['starting', 'growing', 'established'],
  market: 'all', pricingStatus: 'quote_required', optional: true, maxQuantity: 1,
};

export const optionalServices = [
  ...catalog.map(item => ({ ...item, market: 'overseas', pricingStatus: 'priced', optional: true, maxQuantity: item.sampling || item.id === 'PITCH_SETUP' ? 1 : 100 })),
  ...cnCatalog,
  socialListeningService,
];

export function getOptionalServices(market = 'overseas') {
  if (!['cn', 'overseas'].includes(market)) throw new Error('invalid_market');
  return optionalServices.filter(item => item.market === market || item.market === 'all').map(item => ({ ...item, deliverables: [...item.deliverables], prerequisites: [...item.prerequisites], goals: [...item.goals], stages: [...item.stages] }));
}
