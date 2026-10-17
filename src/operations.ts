/** Operation evidence is a trace contract, not a semantic truth oracle.
 * A tool invocation alone never proves a claim. Results must be correlated by
 * call ID, completed, and newer than the latest action. Unknown shapes fail closed.
 */
import { collectText } from './scanner.js'

export interface ToolTrace {
  id: string
  name: string
  args: Record<string, unknown>
  callIndex: number
  resultIndex: number
  state: 'completed' | 'failed' | 'pending' | 'unknown'
  /** Actual tool output, not the author's description of it. */
  resultText: string
  /** Characters dropped from resultText by the review budget; 0/undefined = whole. */
  truncated?: number
  /** Original host turn and event time; historical observations are not fresh checks. */
  turn?: number
  observedAt?: number
}

function object(value: unknown): Record<string, any> {
  if (typeof value === 'string') {
    try { return object(JSON.parse(value)) } catch { return {} }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function resultState(data: Record<string, any>): ToolTrace['state'] {
  const message = object(data.message)
  const body = collectText(message)
  const value = object(data.result ?? data.value ?? message.structuredContent ?? body)
  const records = [data, message, value]
  if (records.some((r) => r.isError === true || r.ok === false || r.success === false || r.error
    || r.timedOut === true || r.cancelled === true || r.aborted === true
    || (typeof r.failed === 'number' && r.failed > 0)
    || ['exitCode', 'exit_code'].some((k) => typeof r[k] === 'number' && r[k] !== 0))
    || (Array.isArray(value.results) && value.results.some((r: any) => r?.ok !== true))
    || /(?:^|\n)\s*\[(?:exit code:\s*-?[1-9]\d*|timed out[^\]]*|stopped:[^\]]*|killed by signal:[^\]]*|sandbox[^\]]*denied[^\]]*)\]\s*$/im.test(body)) return 'failed'
  if (records.some((r) => r.status === 'running' || r.status === 'pending' || r.exitCode === null)
    || /\[(?:still running|running in background|promoted to background)[^\]]*\]/i.test(body)) return 'pending'
  if (Array.isArray(value.results) && value.results.length === 0) return 'unknown'
  if ((!body.trim() || body.trim() === '(no output)') && Object.keys(value).length === 0) return 'unknown'
  return 'completed'
}

export function toolTrace(events: readonly unknown[], turn?: number): ToolTrace[] {
  const calls: ToolTrace[] = []
  const byId = new Map<string, ToolTrace>()
  for (let i = 0; i < events.length; i++) {
    const ev = object(events[i])
    const data = object(ev.data)
    if (turn !== undefined && Number(data.turn) !== turn) continue
    if (ev.type === 'tool/call') {
      const id = String(data.callId ?? data.id ?? '')
      const call: ToolTrace = { id, name: String(data.name ?? ''), args: object(data.arguments), callIndex: i, resultIndex: -1, state: 'pending', resultText: '',
        ...(Number.isFinite(Number(data.turn)) ? { turn: Number(data.turn) } : {}) }
      calls.push(call)
      if (id) byId.set(id, call)
    } else if (ev.type === 'tool/result' && (!ev.surfaceOp || ev.surfaceOp === 'append')) {
      const message = object(data.message)
      const id = String(message.toolCallId ?? message.source?.callId ?? data.callId ?? '')
      const call = byId.get(id)
      if (!call) continue // Never match by name: concurrent calls may finish out of order.
      call.resultIndex = i
      call.state = resultState(data)
      call.resultText = collectText(message) || JSON.stringify(data.result ?? data.value ?? message.structuredContent ?? '')
      if (typeof ev.time === 'number') call.observedAt = ev.time
    }
  }
  return calls
}

