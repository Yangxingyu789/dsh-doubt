import { Context } from '@deepseek-ai/cordis'
import { apply } from '../lib/index.js'


const ctx = new Context()
apply(ctx, { enabled: true, verifyTool: true, promptSection: true, autoVerify: true, factored: true })
ctx.dispose?.()
console.log('SMOKE OK：dsh-doubt 在裸 cordis 里加载不崩，服务缺失时安静等待')
