import { Context } from '@deepseek-ai/cordis'
import { apply } from '../lib/index.js'

// 真 cordis 冒烟：没有 dsh 宿主服务时插件必须安静降级、不崩
const ctx = new Context()
apply(ctx, { enabled: true, verifyTool: true, promptSection: true, autoVerify: true, factored: true })
ctx.dispose?.()
console.log('SMOKE OK：dsh-doubt 在裸 cordis 里加载不崩，服务缺失时安静等待')
