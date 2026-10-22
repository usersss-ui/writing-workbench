const TARGET_VENUE_NAME = "IEEE Transactions on Control of Network Systems"

const CROSS_VENUE_NAMES = new Set([
  "IEEE Transactions on Emerging Topics in Computational Intelligence",
  "Neurocomputing",
  "IET Control Theory & Applications",
  "Journal of the Franklin Institute",
  "Automatica",
  "IEEE Transactions on Signal Processing",
  "IEEE Transactions on Automatic Control",
  "Information Sciences",
])

const ROOT_KEYS = [
  "version",
  "updatedAt",
  "manuscript",
  "targetVenue",
  "crossVenueEvidence",
  "inVenueStyleSamples",
  "materials",
  "claimSummary",
  "blockers",
]

const MANUSCRIPT_KEYS = ["title", "articleType", "submissionReadiness", "summary"]
const TARGET_VENUE_KEYS = ["name", "acronym", "status", "scopeUrl", "authorInfoUrl", "fitSummary"]
const CROSS_VENUE_KEYS = [
  "paperId",
  "title",
  "year",
  "venue",
  "dimensions",
  "usableSections",
  "supportedUse",
  "unsupportedUse",
  "verificationStatus",
  "sourceUrl",
  "usage",
]
const IN_VENUE_KEYS = [
  "paperId",
  "title",
  "year",
  "venue",
  "verifiedPages",
  "sectionOrder",
  "abstractPattern",
  "proofPlacement",
  "experimentPresentation",
  "styleUse",
  "prohibitedUse",
  "verificationStatus",
  "sourceUrl",
  "usage",
  "supportsClaims",
]
const MATERIAL_KEYS = ["materialId", "title", "status", "roleSummary"]
const CLAIM_KEYS = ["claimId", "title", "status", "allowedWording", "prohibitedWording"]
const BLOCKER_KEYS = ["blockerId", "workflow", "status", "nextStep", "completionCondition"]

const MANUSCRIPT_READINESS = new Set(["not_ready"])
const TARGET_VENUE_STATUSES = new Set(["candidate"])
const CROSS_VERIFICATION_STATUSES = new Set(["source_located", "needs_full_text_verification"])
const STYLE_VERIFICATION_STATUSES = new Set([
  "metadata_verified",
  "abstract_verified",
  "partial_full_text_verified",
])
const MATERIAL_STATUSES = new Set(["working"])
const CLAIM_STATUSES = new Set([
  "design_fixed",
  "partially_supported",
  "proof_blocked",
  "experiment_blocked",
  "prohibited_claim",
])
const BLOCKER_STATUSES = new Set(["blocked"])

export const P02_WRITING_DATA = {
  version: 1,
  updatedAt: "2026-09-03",
  manuscript: {
    title: "P02：事件触发零阶在线分布式优化",
    articleType: "算法型研究论文",
    submissionReadiness: "not_ready",
    summary: "当前已有方程闭合的候选 Algorithm 1；两微步网络混合证明、主定理、最近邻全文核验和匹配实验仍未完成。",
  },
  targetVenue: {
    name: TARGET_VENUE_NAME,
    acronym: "TCNS",
    status: "candidate",
    scopeUrl: "https://ieeecss.org/publication/transactions-control-network-systems",
    authorInfoUrl: "https://ieeecss.org/publication/transactions-control-network-systems/information-authors",
    fitSummary: "TCNS 是当前工作候选；期刊选择不代表稿件已满足投稿门禁。",
  },
  crossVenueEvidence: [
    {
      paperId: "E1-Zhang-2024-TETCI",
      title: "Zeroth-Order Decentralized Dual Averaging for Online Optimization With Privacy Consideration",
      year: 2024,
      venue: "IEEE Transactions on Emerging Topics in Computational Intelligence",
      dimensions: ["在线零阶优化", "非平衡网络", "对偶平均"],
      usableSections: ["研究背景", "相关工作", "方法机制"],
      supportedUse: "用于在线零阶分布式对偶平均和原文平均遗憾比较的机制锚点。",
      unsupportedUse: "不支持 P02 的耦合约束、事件触发通信或对称两点估计器主张。",
      verificationStatus: "source_located",
      sourceUrl: "https://doi.org/10.1109/TETCI.2024.3393362",
      usage: "substantive_evidence",
    },
    {
      paperId: "E2-Wang-2022-Neurocomputing",
      title: "Distributed Online Convex Optimization With a Bandit Primal-Dual Mirror Descent Push-Sum Algorithm",
      year: 2022,
      venue: "Neurocomputing",
      dimensions: ["在线优化", "时变有向 Push-Sum", "两点 bandit", "耦合约束"],
      usableSections: ["相关工作", "最近邻差异", "理论工具"],
      supportedUse: "用于比较在线、时变有向 Push-Sum、两点 bandit、耦合约束与遗憾/约束违背的交叉设置。",
      unsupportedUse: "采用每轮通信，不支持事件触发、压缩或通信节省结论。",
      verificationStatus: "needs_full_text_verification",
      sourceUrl: "https://doi.org/10.1016/j.neucom.2022.05.024",
      usage: "substantive_evidence",
    },
    {
      paperId: "E3-Tada-2024-IET",
      title: "Constrained Distributed Online Convex Optimization With Bandit Feedback for Unbalanced Digraphs",
      year: 2024,
      venue: "IET Control Theory & Applications",
      dimensions: ["bandit 反馈", "非平衡有向图", "时变耦合不等式"],
      usableSections: ["研究背景", "相关工作", "差异矩阵"],
      supportedUse: "用于确认 bandit、非平衡有向图与时变耦合不等式的交叉存在。",
      unsupportedUse: "当前摘要证据不支持时变通信拓扑或低通信主张。",
      verificationStatus: "needs_full_text_verification",
      sourceUrl: "https://doi.org/10.1049/cth2.12548",
      usage: "substantive_evidence",
    },
    {
      paperId: "E4-Zhang-2024-JFI",
      title: "Distributed Online Optimization Subject to Long-Term Constraints and Time-Varying Topology: An Event-Triggered and Bandit Feedback Approach",
      year: 2024,
      venue: "Journal of the Franklin Institute",
      dimensions: ["在线优化", "时变拓扑", "事件触发", "bandit 反馈"],
      usableSections: ["相关工作", "通信机制边界", "实验基线规划"],
      supportedUse: "用于比较事件触发、bandit 反馈和触发阈值权衡。",
      unsupportedUse: "长期本地约束或 CACV 不自动等同 P02 的聚合耦合约束指标。",
      verificationStatus: "needs_full_text_verification",
      sourceUrl: "https://doi.org/10.1016/j.jfranklin.2024.107132",
      usage: "substantive_evidence",
    },
    {
      paperId: "E5-Mao-2025-Automatica",
      title: "Distributed Online Optimization With Edge-Based Event-Triggered Communication",
      year: 2025,
      venue: "Automatica",
      dimensions: ["边事件触发", "时变非平衡网络", "Push-Sum", "遗憾分析"],
      usableSections: ["相关工作", "网络与通信边界", "理论工具"],
      supportedUse: "用于比较边事件触发、时变非平衡网络与遗憾分析。",
      unsupportedUse: "一阶反馈且未核验时变耦合约束，不支持 P02 零阶或耦合约束主张。",
      verificationStatus: "needs_full_text_verification",
      sourceUrl: "https://doi.org/10.1016/j.automatica.2024.112068",
      usage: "substantive_evidence",
    },
    {
      paperId: "E6-Yi-2020-TSP",
      title: "Distributed Online Convex Optimization With Time-Varying Coupled Inequality Constraints",
      year: 2020,
      venue: "IEEE Transactions on Signal Processing",
      dimensions: ["在线优化", "时变耦合不等式", "动态遗憾", "约束违背"],
      usableSections: ["问题建模", "相关工作", "理论分支"],
      supportedUse: "用于耦合约束建模、动态遗憾、约束违背及 Slater/强凸分支的比较。",
      unsupportedUse: "不支持零阶 Oracle 或低通信机制主张。",
      verificationStatus: "needs_full_text_verification",
      sourceUrl: "https://doi.org/10.1109/TSP.2020.2964200",
      usage: "substantive_evidence",
    },
    {
      paperId: "E7-Li-2021-TAC",
      title: "Distributed Online Optimization for Multi-Agent Networks With Coupled Inequality Constraints",
      year: 2021,
      venue: "IEEE Transactions on Automatic Control",
      dimensions: ["在线优化", "非平衡网络", "Push-Sum", "耦合不等式"],
      usableSections: ["相关工作", "耦合约束建模", "证明结构"],
      supportedUse: "用于比较 Push-Sum、耦合不等式、动态遗憾与约束违背分解。",
      unsupportedUse: "不支持 bandit、零阶 Oracle、事件触发或压缩通信结论。",
      verificationStatus: "needs_full_text_verification",
      sourceUrl: "https://doi.org/10.1109/TAC.2020.3021011",
      usage: "substantive_evidence",
    },
    {
      paperId: "E8-Li-2021-InformationSciences",
      title: "Online Distributed Dual Averaging Algorithm for Multi-Agent Bandit Optimization Over Time-Varying General Directed Networks",
      year: 2021,
      venue: "Information Sciences",
      dimensions: ["bandit 优化", "时变一般有向网络", "对偶平均", "动态遗憾"],
      usableSections: ["相关工作", "估计器比较", "网络混合与动态遗憾结构"],
      supportedUse: "用于比较 bandit 估计器、有向网络混合、对偶平均和动态遗憾证明结构。",
      unsupportedUse: "不支持耦合不等式或通信节省定理。",
      verificationStatus: "needs_full_text_verification",
      sourceUrl: "https://doi.org/10.1016/j.ins.2021.10.003",
      usage: "substantive_evidence",
    },
  ],
  inVenueStyleSamples: [
    {
      paperId: "S1-Akbari-2017-TCNS",
      title: "Distributed Online Convex Optimization on Time-Varying Directed Graphs",
      year: 2017,
      venue: TARGET_VENUE_NAME,
      verifiedPages: "未从全文核验",
      sectionOrder: "未从全文核验",
      abstractPattern: "未从全文核验",
      proofPlacement: "未从全文核验",
      experimentPresentation: "未从全文核验",
      styleUse: "取得全文后，仅观察标题密度、章节比例与公式/图表布局。",
      prohibitedUse: "不作为 P02 最近邻证据，不支持任何技术新颖性或理论主张。",
      verificationStatus: "metadata_verified",
      sourceUrl: "https://doi.org/10.1109/TCNS.2015.2505149",
      usage: "format_and_style_only",
      supportsClaims: false,
    },
    {
      paperId: "S2-Xiong-2020-TCNS",
      title: "Privacy-Preserving Distributed Online Optimization Over Unbalanced Digraphs via Subgradient Rescaling",
      year: 2020,
      venue: TARGET_VENUE_NAME,
      verifiedPages: "1366–1378（13 页）",
      sectionOrder: "未从全文核验",
      abstractPattern: "问题 → 算法 → 强凸遗憾 → 一般凸/倍增技巧结果 → 仿真",
      proofPlacement: "未从全文核验",
      experimentPresentation: "摘要确认有仿真；详细参数与图表结构未从全文核验。",
      styleUse: "分层报告不同函数类别的结果，并保持摘要中的理论层级清楚。",
      prohibitedUse: "不支持 P02 的隐私、非平衡网络、遗憾阶或算法差异主张。",
      verificationStatus: "abstract_verified",
      sourceUrl: "https://doi.org/10.1109/TCNS.2020.2976273",
      usage: "format_and_style_only",
      supportsClaims: false,
    },
    {
      paperId: "S3-Wang-2023-TCNS",
      title: "A Differentially Private Method for Distributed Optimization in Directed Networks via State Decomposition",
      year: 2023,
      venue: TARGET_VENUE_NAME,
      verifiedPages: "正式版 2165–2177（13 页）；公开预印本 10 页",
      sectionOrder: "引言 → 预备知识与问题 → 算法 → 收敛分析 → 隐私分析 → 仿真 → 结论与未来工作 → 附录",
      abstractPattern: "当前材料未单独核验完整摘要结构",
      proofPlacement: "主要定理位于分析章节，较长支撑证明移至附录。",
      experimentPresentation: "公开参数并报告 50 次运行的平均曲线。",
      styleUse: "用三条编号贡献连接机制、收敛和隐私定理；正文保留主定理，长证明后置。",
      prohibitedUse: "不支持 P02 的状态分解、差分隐私、收敛或有向网络技术主张。",
      verificationStatus: "partial_full_text_verified",
      sourceUrl: "https://ieeexplore.ieee.org/document/10093062/",
      usage: "format_and_style_only",
      supportsClaims: false,
    },
    {
      paperId: "S4-NoRegret-2024-TCNS",
      title: "Distributed No-Regret Learning in Aggregative Games With Residual Bandit Feedback",
      year: 2024,
      venue: TARGET_VENUE_NAME,
      verifiedPages: "1734–1745（12 页）",
      sectionOrder: "未从全文核验",
      abstractPattern: "问题 → 收益与聚合信息困难 → 算法 → 遗憾 → 更强条件下的收敛 → Cournot 仿真",
      proofPlacement: "未从全文核验",
      experimentPresentation: "官方摘要确认 Cournot 仿真；参数和图表细节未从全文核验。",
      styleUse: "结果成立后，可用 first、then、finally 分开不同理论层级。",
      prohibitedUse: "不支持 P02 的 bandit 估计、遗憾、博弈模型或收敛主张。",
      verificationStatus: "abstract_verified",
      sourceUrl: "https://ieeexplore.ieee.org/document/10517445/",
      usage: "format_and_style_only",
      supportsClaims: false,
    },
    {
      paperId: "S5-Quantized-2025-TCNS",
      title: "Distributed Optimization for Quadratic Cost Functions With Quantized Communication and Finite-Time Convergence",
      year: 2025,
      venue: TARGET_VENUE_NAME,
      verifiedPages: "正式版 930–942（13 页）",
      sectionOrder: "引言 → 符号与预备知识 → 问题 → 算法与收敛分析 → 应用 → 结论 → 致谢 → 附录",
      abstractPattern: "当前材料未单独核验完整摘要结构",
      proofPlacement: "主定理留在正文，完整证明移至附录。",
      experimentPresentation: "两个应用使用 20 节点有向图，定义比较误差，并报告 20 次试验均值。",
      styleUse: "用三条主要贡献连接算法、定理和应用，并保持理论与应用可追溯。",
      prohibitedUse: "不支持 P02 的量化通信、有限时间收敛、有向图或实验性能主张。",
      verificationStatus: "partial_full_text_verified",
      sourceUrl: "https://ieeexplore.ieee.org/document/10605038/",
      usage: "format_and_style_only",
      supportsClaims: false,
    },
  ],
  materials: [
    {
      materialId: "P02-WM-00",
      title: "初稿生成与来源说明",
      status: "working",
      roleSummary: "记录来源、实际用途、核验边界与版本链。",
    },
    {
      materialId: "P02-WM-01",
      title: "目标期刊与同刊样本",
      status: "working",
      roleSummary: "记录官方要求，并隔离同刊格式与写作风格样本。",
    },
    {
      materialId: "P02-WM-02",
      title: "主张证据台账",
      status: "working",
      roleSummary: "为每条主张保留状态、允许措辞和禁止措辞。",
    },
    {
      materialId: "P02-WM-03",
      title: "相关工作与差异矩阵",
      status: "working",
      roleSummary: "只使用跨期刊实质证据比较问题、机制、理论和实验边界。",
    },
    {
      materialId: "P02-WM-04",
      title: "章节写作材料",
      status: "working",
      roleSummary: "按章节整理段落职责、可用证据、缺失输入与允许时态。",
    },
    {
      materialId: "P02-WM-05",
      title: "投稿缺口与任务清单",
      status: "working",
      roleSummary: "记录六类投稿门禁的任务、完成条件与证据位置。",
    },
  ],
  claimSummary: [
    {
      claimId: "C01",
      title: "P02 问题合同已固定",
      status: "design_fixed",
      allowedWording: "本文考虑在线分离局部决策、时变非平衡有向网络与全局耦合不等式。",
      prohibitedWording: "不得据此声称模型已经保证可行或收敛。",
    },
    {
      claimId: "C03",
      title: "两点估计的局部恒等式仅获部分支持",
      status: "partially_supported",
      allowedWording: "在查询可行与条件独立下，估计器对应球平滑梯度；完整证明链仍待闭合。",
      prohibitedWording: "不得声称已经获得原非光滑函数的无偏梯度。",
    },
    {
      claimId: "C09",
      title: "联合次线性理论目标尚未证明",
      status: "proof_blocked",
      allowedWording: "目标是寻找使遗憾、约束违背和协调误差同时为次线性的参数区间。",
      prohibitedWording: "不得预填具体复杂度阶。",
    },
    {
      claimId: "C12",
      title: "匹配实验尚未执行",
      status: "experiment_blocked",
      allowedWording: "将在最终算法固定后按统一口径比较基线。",
      prohibitedWording: "不得声称实验已经验证理论或优于基线。",
    },
    {
      claimId: "C14",
      title: "全球首次或唯一不可声称",
      status: "prohibited_claim",
      allowedWording: "在截至当前已核验样本范围内，尚未发现同时匹配全部维度的结果。",
      prohibitedWording: "不得声称全球首次、唯一或不存在类似工作。",
    },
  ],
  blockers: [
    {
      blockerId: "B-ALGORITHM",
      workflow: "算法",
      status: "blocked",
      nextStep: "把逐边生成—释放方程实现为最小状态机，并展开两微步扩展矩阵。",
      completionCondition: "通过三块守恒、列和、有限时正性、有界释放及全通信退化测试，再给出统一分母下界。",
    },
    {
      blockerId: "B-THEORY",
      workflow: "理论",
      status: "blocked",
      nextStep: "完成 L1–L10 并闭合触发、网络、对偶和原变量的反馈链。",
      completionCondition: "每个引理有明确假设、常数和依赖，并导出可复核的 T1–T3。",
    },
    {
      blockerId: "B-LITERATURE",
      workflow: "文献",
      status: "blocked",
      nextStep: "完成 E2–E8 全文核验并复核正式书目信息。",
      completionCondition: "差异矩阵各项可定位到原文，且不含全球排他措辞。",
    },
    {
      blockerId: "B-EXPERIMENT",
      workflow: "实验",
      status: "blocked",
      nextStep: "最终算法冻结后重新实现并建立统一通信与 Oracle 统计口径。",
      completionCondition: "守恒和退化测试通过，基线、随机种子、均值与置信区间齐全。",
    },
    {
      blockerId: "B-WRITING",
      workflow: "写作",
      status: "blocked",
      nextStep: "按主张状态重写摘要、贡献、相关工作、理论、实验和结论。",
      completionCondition: "每个完成式句子均可链接至证明或实验，限制与失败条件显式。",
    },
    {
      blockerId: "B-FORMAT",
      workflow: "格式",
      status: "blocked",
      nextStep: "使用投稿时有效的 IEEE/TCNS 官方模板完成排版与检查。",
      completionCondition: "页数、摘要、作者 ORCID、图表公式和投稿系统预览全部通过人工验收。",
    },
  ],
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false
  const actualKeys = Reflect.ownKeys(value)
  return actualKeys.length === keys.length
    && actualKeys.every((key) => typeof key === "string" && keys.includes(key))
    && keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value")
    })
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0
}

function isJsonArray(value) {
  if (!Array.isArray(value)) return false
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.some((key) => typeof key !== "string")) return false
  if (ownKeys.length !== value.length + 1 || !ownKeys.includes("length")) return false
  return Array.from({ length: value.length }, (_, index) => String(index)).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value")
  })
}

function isNonEmptyStringArray(value) {
  return isJsonArray(value) && value.length > 0 && value.every(isNonEmptyString)
}

function parseHttpsUrl(value) {
  if (!isNonEmptyString(value)) return false
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || !isNonEmptyString(url.hostname)) return null
    if (url.username || url.password || url.port || url.search || url.hash) return null
    return url
  } catch {
    return null
  }
}

function canonicalPaperSource(value) {
  const url = parseHttpsUrl(value)
  if (!url) return null

  if (url.hostname === "doi.org") {
    const doi = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/gu, "").toLowerCase()
    if (!/^10\.\d{4,9}\/.+/u.test(doi)) return null
    return `doi:${doi}`
  }

  if (url.hostname === "ieeexplore.ieee.org") {
    const match = url.pathname.match(/^\/document\/(\d+)\/?$/u)
    return match ? `ieee-document:${match[1]}` : null
  }

  return null
}

function isOfficialTargetUrl(value, expectedPath) {
  const url = parseHttpsUrl(value)
  return url?.hostname === "ieeecss.org" && url.pathname.replace(/\/+$/u, "") === expectedPath
}

function containsPrivatePath(value, seen = new WeakSet()) {
  if (typeof value === "string") {
    const slash = "/"
    const backslash = String.fromCharCode(92)
    const lower = value.toLowerCase()
    if (lower.includes([slash, "users", slash].join(""))) return true
    if (lower.includes(["file", ":", slash, slash].join(""))) return true
    if (value.includes(backslash.repeat(2))) return true

    for (let index = 0; index < value.length - 2; index += 1) {
      const driveLetter = value[index]
      const hasDrivePrefix = /^[A-Za-z]$/u.test(driveLetter) && value[index + 1] === ":"
      const isHttpsScheme = index === 4 && lower.startsWith(["https", ":", slash, slash].join(""))
      if (hasDrivePrefix && [slash, backslash].includes(value[index + 2]) && !isHttpsScheme) return true
    }
    return false
  }

  if (value === null || typeof value !== "object") return false
  if (seen.has(value)) return true
  seen.add(value)

  return Reflect.ownKeys(value).some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return true
    const keyText = typeof key === "symbol" ? key.description ?? "" : key
    return containsPrivatePath(keyText, seen) || containsPrivatePath(descriptor.value, seen)
  })
}

function validateManuscript(value) {
  return hasExactKeys(value, MANUSCRIPT_KEYS)
    && isNonEmptyString(value.title)
    && isNonEmptyString(value.articleType)
    && MANUSCRIPT_READINESS.has(value.submissionReadiness)
    && isNonEmptyString(value.summary)
}

function validateTargetVenue(value) {
  return hasExactKeys(value, TARGET_VENUE_KEYS)
    && value.name === TARGET_VENUE_NAME
    && value.acronym === "TCNS"
    && TARGET_VENUE_STATUSES.has(value.status)
    && isOfficialTargetUrl(value.scopeUrl, "/publication/transactions-control-network-systems")
    && isOfficialTargetUrl(value.authorInfoUrl, "/publication/transactions-control-network-systems/information-authors")
    && isNonEmptyString(value.fitSummary)
}

function validateCrossVenueRecord(value) {
  return hasExactKeys(value, CROSS_VENUE_KEYS)
    && isNonEmptyString(value.paperId)
    && isNonEmptyString(value.title)
    && Number.isInteger(value.year)
    && value.year >= 1900
    && value.year <= 2100
    && CROSS_VENUE_NAMES.has(value.venue)
    && isNonEmptyStringArray(value.dimensions)
    && isNonEmptyStringArray(value.usableSections)
    && isNonEmptyString(value.supportedUse)
    && isNonEmptyString(value.unsupportedUse)
    && CROSS_VERIFICATION_STATUSES.has(value.verificationStatus)
    && canonicalPaperSource(value.sourceUrl) !== null
    && value.usage === "substantive_evidence"
}

function validateInVenueRecord(value) {
  return hasExactKeys(value, IN_VENUE_KEYS)
    && isNonEmptyString(value.paperId)
    && isNonEmptyString(value.title)
    && Number.isInteger(value.year)
    && value.year >= 1900
    && value.year <= 2100
    && value.venue === TARGET_VENUE_NAME
    && isNonEmptyString(value.verifiedPages)
    && isNonEmptyString(value.sectionOrder)
    && isNonEmptyString(value.abstractPattern)
    && isNonEmptyString(value.proofPlacement)
    && isNonEmptyString(value.experimentPresentation)
    && isNonEmptyString(value.styleUse)
    && isNonEmptyString(value.prohibitedUse)
    && STYLE_VERIFICATION_STATUSES.has(value.verificationStatus)
    && canonicalPaperSource(value.sourceUrl) !== null
    && value.usage === "format_and_style_only"
    && value.supportsClaims === false
}

function validateMaterial(value) {
  return hasExactKeys(value, MATERIAL_KEYS)
    && isNonEmptyString(value.materialId)
    && isNonEmptyString(value.title)
    && MATERIAL_STATUSES.has(value.status)
    && isNonEmptyString(value.roleSummary)
}

function validateClaim(value) {
  return hasExactKeys(value, CLAIM_KEYS)
    && isNonEmptyString(value.claimId)
    && isNonEmptyString(value.title)
    && CLAIM_STATUSES.has(value.status)
    && isNonEmptyString(value.allowedWording)
    && isNonEmptyString(value.prohibitedWording)
}

function validateBlocker(value) {
  return hasExactKeys(value, BLOCKER_KEYS)
    && isNonEmptyString(value.blockerId)
    && isNonEmptyString(value.workflow)
    && BLOCKER_STATUSES.has(value.status)
    && isNonEmptyString(value.nextStep)
    && isNonEmptyString(value.completionCondition)
}

function hasUniqueStrings(values) {
  return values.length === new Set(values).size
}

function canonicalTitleIdentity({ title, year }) {
  const normalizedTitle = title.normalize("NFKC").toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "")
  return `${year}:${normalizedTitle}`
}

export function validateP02WritingData(value) {
  try {
    if (!hasExactKeys(value, ROOT_KEYS) || containsPrivatePath(value)) return false
    if (value.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/u.test(value.updatedAt)) return false
    if (!validateManuscript(value.manuscript) || !validateTargetVenue(value.targetVenue)) return false
    if (!isJsonArray(value.crossVenueEvidence) || value.crossVenueEvidence.length === 0) return false
    if (!isJsonArray(value.inVenueStyleSamples) || value.inVenueStyleSamples.length === 0) return false
    if (!isJsonArray(value.materials) || value.materials.length !== 6) return false
    if (!isJsonArray(value.claimSummary) || value.claimSummary.length === 0) return false
    if (!isJsonArray(value.blockers) || value.blockers.length === 0) return false
    if (!value.crossVenueEvidence.every(validateCrossVenueRecord)) return false
    if (!value.inVenueStyleSamples.every(validateInVenueRecord)) return false
    if (!value.materials.every(validateMaterial)) return false
    if (!value.claimSummary.every(validateClaim)) return false
    if (!value.blockers.every(validateBlocker)) return false

    const papers = [...value.crossVenueEvidence, ...value.inVenueStyleSamples]
    if (!hasUniqueStrings(papers.map(({ paperId }) => paperId))) return false
    if (!hasUniqueStrings(papers.map(({ sourceUrl }) => canonicalPaperSource(sourceUrl)))) return false
    if (!hasUniqueStrings(papers.map(canonicalTitleIdentity))) return false
    if (!hasUniqueStrings(value.materials.map(({ materialId }) => materialId))) return false
    if (!hasUniqueStrings(value.claimSummary.map(({ claimId }) => claimId))) return false
    return hasUniqueStrings(value.blockers.map(({ blockerId }) => blockerId))
  } catch {
    return false
  }
}
