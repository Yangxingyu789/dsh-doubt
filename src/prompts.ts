import type { Evidence } from './evidence.js'
import type { FactoredOutcome } from './factored.js'

export type Lang = 'zh' | 'en'

/** 按回答文本判断注入语言（含 CJK 就走中文） */
export function detectLanguage(text: string, preferred: 'auto' | Lang = 'auto'): Lang {
  if (preferred === 'zh' || preferred === 'en') return preferred
  return /[\u3400-\u9fff]/.test(text) ? 'zh' : 'en'
}

const VERDICT_LABEL: Record<Lang, Record<Evidence['verdict'], string>> = {
  zh: { confirmed: '已证实', refuted: '已证伪', inconclusive: '证据冲突', unverifiable: '无法核验' },
  en: { confirmed: 'confirmed', refuted: 'refuted', inconclusive: 'conflicting', unverifiable: 'unverifiable' },
}

export interface EvidenceSectionInput {
  evidence: readonly Evidence[]
  factored?: Readonly<Record<string, FactoredOutcome>>
  strictLabeling: boolean
  requireSources: number
  online: boolean
}

/**
 * 注入的是**插件已经实测到的证据**，不是「请你去核验」。
 * 这是把 intrinsic self-correction（文献里会变差）换成 external feedback（文献里有效）的关键。
 */
export function buildEvidenceText(input: EvidenceSectionInput, lang: Lang): string {
  const { evidence, factored, strictLabeling, requireSources, online } = input
  const L = VERDICT_LABEL[lang]

  const refuted = evidence.filter((e) => e.verdict === 'refuted')
  const conflicting = evidence.filter((e) => e.verdict === 'inconclusive')
  const unverifiable = evidence.filter((e) => e.verdict === 'unverifiable')
  const confirmed = evidence.filter((e) => e.verdict === 'confirmed')

  const block = (items: readonly Evidence[]): string =>
    items.map((e) => {
      const lines = [`${L[e.verdict]} · (${e.kind}) ${e.claim}`]
      for (const p of e.provenance) lines.push(`   ${p}`)
      if (e.note) lines.push(`   ! ${e.note}`)
      const f = factored?.[e.claimId]
      if (f && f.available) {
        lines.push(f.majority
          ? `   ~ 独立重推导 ${f.agree}/${f.total} 一致：${f.majority}`
          : `   ~ 独立重推导${f.reason ? ` ${f.reason}` : '（无多数）'}`)
      }
      return lines.join('\n')
    }).join('\n\n')

  const parts: string[] = []
  const net = online
    ? lang === 'zh' ? `联网可用：confirmed 需 ≥${requireSources} 个独立来源一致` : `online: confirmed requires ≥${requireSources} independent agreeing sources`
    : lang === 'zh' ? '离线：只用本机确定性来源（文件系统 / node_modules / PATH / 锁文件）' : 'offline: deterministic local sources only (filesystem / node_modules / PATH / lockfiles)'

  if (refuted.length > 0) {
    parts.push(lang === 'zh'
      ? `以下断言已被**实测证伪**（不是我的猜测，是执行结果）：\n\n${block(refuted)}`
      : `The following assertions were **refuted by actual execution** (not a guess):\n\n${block(refuted)}`)
  }
  if (conflicting.length > 0) {
    parts.push(lang === 'zh'
      ? `以下断言的取证结果**互相冲突**，需要你再取一次证：\n\n${block(conflicting)}`
      : `Evidence for these assertions **conflicts**; verify once more:\n\n${block(conflicting)}`)
  }
  if (unverifiable.length > 0) {
    parts.push(lang === 'zh'
      ? `以下断言本机与网络都**拿不出判据**：\n\n${block(unverifiable)}`
      : `No judge is available locally or online for these assertions:\n\n${block(unverifiable)}`)
  }
  if (confirmed.length > 0) {
    parts.push(lang === 'zh'
      ? `以下断言已核实无误，无需改动：\n${confirmed.map((e) => `- (${e.kind}) ${e.claim}`).join('\n')}`
      : `These assertions check out, no change needed:\n${confirmed.map((e) => `- (${e.kind}) ${e.claim}`).join('\n')}`)
  }

  const rules = lang === 'zh'
    ? [
        '对已证伪的条目，明确写出「之前错了：X → 正确的是 Y」并给出上面的实测输出，不要静默改写。',
        '对证据冲突的条目，再取一次证；说明每个来源分别说了什么。',
        unverifiable.length > 0 || strictLabeling
          ? '无法核验的断言，在最终回答里逐条标注「未验证」并说明为什么无法核验——不许用「应该」「大概」代替证据。'
          : '',
        '不要重复粘贴原答案；只给修正后的结论与证据。',
      ].filter(Boolean)
    : [
        'For refuted items, write "earlier I was wrong: X → correct is Y" and cite the measured output above; never silently rewrite.',
        'For conflicting items, verify once more and state what each source said.',
        unverifiable.length > 0 || strictLabeling
          ? 'Mark unverifiable assertions "unverified" one by one and say why; do not substitute "probably" for evidence.'
          : '',
        'Do not re-paste the original answer; give only the corrected conclusion with evidence.',
      ].filter(Boolean)

  return [
    lang === 'zh' ? `[dsh-doubt 取证结果] ${net}` : `[dsh-doubt evidence] ${net}`,
    '',
    ...parts,
    '',
    lang === 'zh' ? '要求：' : 'Requirements:',
    ...rules.map((r, i) => `${i + 1}. ${r}`),
  ].join('\n')
}

/** 兜底：完全无法机械核验时，才退化成让模型自己取证的一轮 */
export function buildRecheckText(
  claims: readonly { kind: string; text: string; unmechanizable?: string }[],
  score: number,
  lang: Lang,
  maxFindings: number,
): string {
  const picked = claims.slice(0, maxFindings)
  const lines = picked.map((c, i) => `${i + 1}. (${c.kind}) ${c.text}${c.unmechanizable ? `\n   → ${c.unmechanizable}` : ''}`)
  const rules = (lang === 'zh'
    ? [
        '逐条用工具取证：跑命令、读文件、查 registry 或类型定义，不要凭记忆复述。',
        '取证后给出**修正版结论**；被推翻的部分明确写「之前错了：……」，不要悄悄改。',
        '确实无法核验的断言，标注「未验证」并说明为什么无法核验。',
      ]
    : [
        'Verify each item with tools: run the command, read the file, check the registry or type definitions. Do not answer from memory.',
        'Then give a **corrected conclusion**; for anything refuted, state explicitly "earlier I was wrong: …".',
        'If an assertion genuinely cannot be verified, mark it "unverified" and say why.',
      ]).map((r, i) => `${i + 1}. ${r}`).join('\n')
  const head = lang === 'zh'
    ? `[dsh-doubt] 本机无法自动核验 ${picked.length} 条断言（风险分 ${score}），需要你亲自取证：`
    : `[dsh-doubt] ${picked.length} assertion(s) could not be checked automatically (risk score ${score}); verify them yourself:`
  return `${head}\n${lines.join('\n')}\n\n${lang === 'zh' ? '要求：' : 'Requirements:'}\n${rules}`
}

export interface ProvenanceSectionInput {
  files: readonly string[]
  score: number
  findings: readonly { kind: string; snippet: string }[]
}

/**
 * 交付文档的**溯源要求**。
 *
 * 这不是「再想想你确定吗」——文献里那种 intrinsic self-correction 会让结果变差。
 * 它要求的是一份**具体产物**：逐步骤溯源表。
 *
 * 依据来自实测：同一个模型在被问「所有流程是否都有据可依」时，能自己给出
 * 42 项 / 9 类（纯官方 13、官方其他产品线 2、官方+社区 1、官方+实测 1、纯社区 1、
 * 纯实测 2、工程实践 13、未验证 7、混合 2）的溯源表——**能力在，缺的只是在正确的
 * 时机自动要一次**。所以这里不判对错，只强制披露。
 */
export function buildProvenanceText(input: ProvenanceSectionInput, lang: Lang): string {
  const { files, score, findings } = input
  const fileList = files.map((f) => `- ${f}`).join('\n')
  const kinds = findings.slice(0, 6).map((f) => `- (${f.kind}) ${f.snippet}`).join('\n')
  if (lang === 'zh') {
    return [
      '[dsh-doubt 溯源要求] 你这一轮写出了交付文档，但正文里没有任何出处标注：',
      fileList,
      '',
      `扫描到风险分 ${score} 的具体断言（节选，不是全部）：`,
      kinds,
      '',
      '要求（这不是让你「再检查一遍」，是要你补一个具体产物）：',
      '1. 在文档里加一节「逐步骤溯源表」，按步骤/条目逐条列出依据。',
      '2. 依据只有两类：**有出处**（给出可点的官方链接、文档标题或版本号）／**无依据**（工程经验或推测）。',
      '3. 无依据的条目必须留在表里并显式标注；不许删掉，也不许用「一般」「应该」糊过去。',
      '4. 表里凡是能机械核对的（链接是否可达、版本号是否对得上、文件/路径是否存在），先核对再写进「有出处」。',
      '5. 只补这一节和必要的修正，不要重写全文。',
    ].join('\n')
  }
  return [
    '[dsh-doubt provenance] You wrote a deliverable document this turn, but the body carries no source labels:',
    fileList,
    '',
    `Specific assertions scanned (risk score ${score}), excerpt only:`,
    kinds,
    '',
    'Requirements (this is not "check again" — it asks for one concrete artifact):',
    '1. Add a "step-by-step provenance" section listing the basis for every step/item.',
    '2. Only two categories: **sourced** (clickable official link, doc title, or version) / **unsourced** (engineering experience or inference).',
    '3. Keep unsourced items in the table and label them explicitly; do not drop them and do not soften them with "generally".',
    '4. For anything mechanically checkable (link reachable, version matches, file/path exists), check it before calling it sourced.',
    '5. Add that section and only the necessary corrections; do not rewrite the whole document.',
  ].join('\n')
}

const GUARD_SECTION_ZH = `## 危险变更闸门（dsh-doubt）

以下动作会改变**正在运行**的宿主或系统，属于危险变更：
- 写入/替换 \`.dsh/profiles/**\`、\`.dsh/plugins/**\`（含在 live profile 里 \`pnpm/npm install\`、安装或重载插件）；
- 杀进程 / 停服务 / \`shutdown\` / 改自启动；
- 修改注册表、服务、计划任务；
- 递归删除文件或目录；
- 覆盖系统目录（\`C:\\Windows\`、\`Program Files\`、\`ProgramData\`）。

动作前必须：给出备份位置和可直接执行的回滚命令；向用户说明影响面并取得确认——这类动作不许自行决定就做。
动作后必须：**另起一次工具调用**做独立健康检查，并把实测结果写进回答（安装回执不算健康检查）；健康检查失败 → 立即停止后续任务，直接给出回滚步骤。
违反时最终审核会打回；不要用「已完成」措辞掩盖缺失的证据。`

const GUARD_SECTION_EN = `## Live-mutation guard (dsh-doubt)

These actions change the **running** host or system and are dangerous mutations:
- writing/replacing files under \`.dsh/profiles/**\` or \`.dsh/plugins/**\` (including \`pnpm/npm install\` in a live profile, installing or hot-reloading a plugin);
- killing processes, stopping services, \`shutdown\`, changing autostart;
- registry, service or scheduled-task changes;
- recursive file/directory deletion;
- overwriting system directories (\`C:\\Windows\`, \`Program Files\`, \`ProgramData\`).

Before acting you must: give a backup location and a directly executable rollback command; explain the impact to the user and obtain confirmation — never decide on such an action by yourself.
After acting you must: start a **separate tool call** as an independent health check and put the measured result in the answer (an install receipt is not a health check). If the health check fails, stop the remaining work immediately and give the rollback steps.
The final review rejects a draft that lacks any of these; do not hide the gap behind "completed" wording.`

/** 系统提示词段：说明分层取证策略与硬性禁令 */
export function promptSection(
  lang: Lang,
  opts: { requireSources: number; guardLiveMutation?: boolean } = { requireSources: 2 },
): string {
  return lang === 'zh'
    ? `## 分层取证（dsh-doubt）

你有一个 \`verify_claims\` 工具：它会在本机**真实执行**你提交的检查（命令 / 文件 / HTTP / 表达式），返回实测结果。插件自身也会在每轮结束后自动取证并把结果贴给你。

取证优先级（严格按此顺序）：
1. 本机确定性来源：执行结果、文件系统、\`node_modules\`、\`package.json\`、锁文件、\`PATH\`。
2. 联网可用时：至少 ${opts.requireSources} 个**互相独立**的来源一致才算确认（例如两个 registry、官方文档 + 本地安装）。
3. 离线且无本机判据时：把断言改写成自包含的小问题独立重推导多次，取多数；**不要**用「再想想你确定吗」这种方式——它会把对的改成错的。

${opts.guardLiveMutation === true ? `${GUARD_SECTION_ZH}\n\n` : ''}硬性禁令：
- 这些规则覆盖工具操作、代码修改、安装/配置/修复、系统诊断和文件交付。执行成功不等于目标达成；修改后先单独复测，再宣布完成。
- 操作/诊断的每条确定结论须写明对象、检查方法、实测结果；没有完成的相关检查就写「未验证」。调用过 bash/read 不代表整轮已经取证。最终回答在显示前会独立审核；doubt_review 返回缺口时继续实际取证，不要只改措辞。
- 「缺失/不存在/无关联」必须说明查找范围并独立复核；路径解析失败、模板占位符或查询机制不同不能直接判作故障。
- 命令、路径、版本号、包名、API 签名、具体数字，没有实测证据就不要断言。
- 编号、ID、哈希、URL、文件路径、API 名称一律不许凭记忆写；不确定就去查或明确标注「未核实」。
- 不要用「一定」「绝对」「100%」，除非有上面的证据。
- 被指出错误时写清「之前错了：X → 正确的是 Y」，不要静默改写。
- 无法核验就标「未验证」，不要用「应该」「大概」「一般来说」掩盖没查过。`
    : `## Tiered verification (dsh-doubt)

You have a \`verify_claims\` tool: it **actually executes** the checks you submit (command / file / HTTP / expression) and returns measured results. The plugin also verifies automatically after each turn and hands you the results.

Evidence order (strict):
1. Deterministic local sources: execution results, filesystem, \`node_modules\`, \`package.json\`, lockfiles, \`PATH\`.
2. When online: require ${opts.requireSources} **independent** agreeing sources (e.g. two registries, official docs + local install).
3. When offline with no local judge: rewrite the assertion into a self-contained question, re-derive it independently several times, and take the majority. Do **not** do "think again, are you sure?" — that flips correct answers into wrong ones.

${opts.guardLiveMutation === true ? `${GUARD_SECTION_EN}\n\n` : ''}Hard rules:
- Apply these rules to tool operations, code changes, installs/configuration/repairs, system diagnosis and deliverables. Execution success is not goal completion; test postconditions separately after a change.
- For each definite operation/diagnosis conclusion, state the target, method and measured result. Without a completed relevant check, say "unverified". Final answers are independently reviewed before display; when doubt_review returns evidence gaps, obtain actual evidence instead of merely rephrasing.
- For missing/nonexistent/unassociated diagnoses, state search scope and cross-check independently. Parsing errors, template placeholders and differing lookup mechanisms do not by themselves prove a fault.
- Do not assert a command, path, version, package name, API signature, or number without measured evidence.
- Never write identifiers, IDs, hashes, URLs, file paths, or API names from memory; look them up or label them "not verified".
- Do not use "definitely", "absolutely", "100%" without the evidence above.
- When corrected, write "earlier I was wrong: X → correct is Y"; never silently rewrite.
- If it cannot be verified, mark it "unverified"; do not cover an unchecked guess with "probably" or "generally".`
}
