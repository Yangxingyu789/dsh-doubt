import type { Finding } from './scanner.js'

export type Lang = 'zh' | 'en'

/** 按回答文本判断注入语言（含 CJK 就走中文） */
export function detectLanguage(text: string, preferred: 'auto' | Lang = 'auto'): Lang {
  if (preferred === 'zh' || preferred === 'en') return preferred
  return /[\u3400-\u9fff]/.test(text) ? 'zh' : 'en'
}

const RULES: Record<Lang, string[]> = {
  zh: [
    '逐条用工具取证：跑命令、读文件、查 registry 或类型定义，不要凭记忆复述。',
    '取证后给出**修正版结论**；被推翻的部分明确写「之前错了：……」，不要悄悄改。',
    '确实无法核验的断言，标注「未验证」并说明为什么无法核验。',
    '全部处理完就正常结束本轮，不要重复粘贴原答案。',
  ],
  en: [
    'Verify each item with tools: run the command, read the file, check the registry or type definitions. Do not answer from memory.',
    'Then give a **corrected conclusion**; for anything refuted, state explicitly "earlier I was wrong: …" instead of silently changing it.',
    'If an assertion genuinely cannot be verified, mark it "unverified" and say why.',
    'Finish the turn normally once every item is handled; do not re-paste the original answer.',
  ],
}

const HEADER: Record<Lang, string> = {
  zh: '[dsh-doubt 自动复核] 你上一轮回答里有',
  en: '[dsh-doubt auto-recheck] Your previous answer contained',
}

const FOOTER: Record<Lang, string> = {
  zh: '如果某条断言你已经有证据（只是没贴出来），直接贴证据即可。',
  en: 'If you already have evidence for an item and just omitted it, paste the evidence directly.',
}

/** 自动复核轮要注入给模型的文本 */
export function buildRecheckText(
  findings: readonly Finding[],
  score: number,
  lang: Lang,
  maxFindings: number,
): string {
  const picked = findings.slice(0, maxFindings)
  const lines = picked.map((f, i) => `${i + 1}. (${f.kind}) ${f.snippet}\n   → ${f.hint}`)
  const rules = RULES[lang].map((r, i) => `${i + 1}. ${r}`).join('\n')
  const head = lang === 'zh'
    ? `${HEADER.zh} ${picked.length} 条「可核验但没给证据」的断言（风险分 ${score}）：`
    : `${HEADER.en} ${picked.length} verifiable assertion(s) with no evidence (risk score ${score}):`
  const tail = lang === 'zh' ? '要求：' : 'Requirements:'
  return `${head}\n${lines.join('\n')}\n\n${tail}\n${rules}\n\n${FOOTER[lang]}`
}

/** 系统提示词里的一段使用指引（让模型知道有 verify_claims 可用） */
export function promptSection(lang: Lang): string {
  return lang === 'zh'
    ? `## 答案自检（dsh-doubt）

你有一个 \`verify_claims\` 工具：它会在本机**真实执行**你提交的检查（命令 / 文件 / HTTP / 表达式），并返回每条断言的实测结果。

规则：
- 给出命令、路径、版本号、包名、API 签名、具体数字之前，先用 \`verify_claims\` 取证，再在回答里引用实测输出。
- 不确定就说不确定，并说明你核验到了哪一步；不要用「应该」「大概」「一般来说」掩盖没查过。
- 不要为了显得可靠而使用「一定」「绝对」「100%」，除非有上面那种证据。
- 被指出错误时，明确写出「之前错了：X → 正确的是 Y」，不要静默改写。`
    : `## Answer self-check (dsh-doubt)

You have a \`verify_claims\` tool: it **actually executes** the checks you submit (command / file / HTTP / expression) on this machine and returns measured results for each assertion.

Rules:
- Before stating a command, path, version, package name, API signature, or specific number, verify it with \`verify_claims\` and cite the measured output.
- If you are unsure, say so and state how far you verified; do not hide an unchecked guess behind "probably", "roughly", or "generally".
- Do not use "definitely", "absolutely", or "100%" unless you have the kind of evidence above.
- When corrected, write explicitly "earlier I was wrong: X → correct is Y"; never silently rewrite.`
}
