// dsh-question-mode · 宿主半边
//
// 干一件事：**别再用「结束本轮对话」代替「向用户提问」。**
//
// 三层：
//   1) 提示词段落  question-mode:policy ── 开关打开时进系统提示词，写明什么时候必须用
//      ask_user_question 提问、什么时候才允许直接收尾（任务真的完成、只需要汇报）。
//   2) 硬兜底      agent/turn-stopping ── 模型这一轮居然没问过就准备收尾时，往收件箱
//      里塞一条 user 消息。agent-loop 在 turn-stopping 之后会再看一眼 next-step，
//      发现非空就不 break，而是继续跑一步 ── 于是它必须面对「问，还是宣布完成」。
//      每个 turn 最多兜底一次，模型第二次还是要收尾就让它收尾（不死循环）。
//   3) 本机路由    /dsh-question-mode/state · /dsh-question-mode/set ── 给网页半边的
//      开关读/写；状态落盘在 $DSH_HOME/question-mode.json，宿主重启也不丢。
//
// 为什么注入的消息用 role: 'user' + source.kind: 'question-mode'：
//   agent-loop 把收件箱消息硬写成 user/message 事件，session 校验又要求角色必须是 user
//   （developer 会被直接抛错，而且 dsh-llm 会把 developer 消息从请求里摘掉，模型看不见）。
//   source.kind 用自定义标记，网页端就能和真人打的字区分开。

import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 插件名：也是日志前缀、source.kind、路由命名空间。 */
export const name = 'question-mode'

/** 只依赖系统提示词；tools / webServer / attachments 用 ctx.inject 软拿，缺了也能用。 */
export const inject = ['systemPrompt']

/**
 * 自己这套提问工具的挂起表：callId → 等待中的提问。
 * 不走原生 `ctx.userQuestions`，所以 UI、答案字段（含附件）全由我们自己定。
 */
const pendingQuestions = new Map()


const ROUTE = '/dsh-question-mode'
const ASK_TOOL = 'ask_user'
const SOURCE_KIND = 'question-mode'
const SECTION_ORDER = 501

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const STATE_FILE = join(DSH_HOME, 'question-mode.json')
const TRACE_FILE = join(DSH_HOME, 'question-mode.log')

/** 往自己的小日志里记一行（排查「图片到底走到哪一步」用）。 */
function trace(message) {
  try {
    mkdirSync(DSH_HOME, { recursive: true })
    appendFileSync(TRACE_FILE, `${new Date().toISOString()} ${message}\n`, 'utf8')
  } catch {
    /* 记不了就算了 */
  }
}

const POLICY = `### 提问模式（已开启）

用户打开了「提问模式」。它只有一条规则：**不要用"结束本轮对话"来代替"向用户提问"**。

只要还有下一步需要用户回应，就不要停下来收尾，而是调用 ask_user 工具提问，等用户回答后在同一轮里继续做：

1. 需要用户在几个方案里选一个 —— 哪怕你已经试过或推荐过其中一个，也要把方案放进 options 里提问，不能把方案写进正文然后结束本轮。
2. 刚做完一步操作，需要用户确认效果（界面对不对、程序有没有报错、结果是不是他要的）。
3. 你在用户桌面上创建了脚本、命令或临时文件需要用户自己运行 —— 提问问"跑完了吗 / 有没有报错"，并索取运行输出或参数。
4. 需要只有用户才知道的信息（路径、账号、端口、参数、环境、选择）。
5. 任何"我说完这句就停下等回复"的时刻。

唯一允许直接结束本轮的情况：任务已经彻底完成，且只需要向用户汇报结果。这时明确说明任务完成、把结果讲清楚即可，不要为了提问而提问。

提问要求：一个问题、具体、能直接回答；需要选择时给 2–4 个 options；别在提问后又补一句"要不要继续"然后收尾 —— 用工具问。`

/** 只有「动手前确认理解」开着时才拼进提示词。 */
const POLICY_CONFIRM = `
### 动手前先确认理解（提问模式的一部分，不是可选项）

收到用户的要求后，**不要理解完就直接开始做**。中间必须多一步：

1. 先用一两句话把你的理解讲清楚 —— 你要我改什么 / 做成什么样 / 我准备怎么做（要点式，不要复述原话，也不要写长篇方案）。
2. 然后立刻用 ask_user 提问确认，例如 options：「理解对了，开始做」/「有偏差，我说一下哪里不对」/「先别做，我再补充」。
3. 用户确认后才执行；用户指出偏差就先按他说的修正理解，必要时再确认一次 —— 但不要陷入反复确认，理解对齐一次就动手。

理由：你的理解可能是错的，而用户只有看到你的理解才可能发现。宁可多问一句，也不要埋头做出一个不对的东西。这一条优先于"直接动手"的默认习惯。
`

const NUDGE = `【提问模式】你刚刚准备结束本轮，但提问模式开着：除了"任务已彻底完成、只需要汇报结果"，都不该用结束对话来代替提问。

现在二选一：
- 如果还有下一步需要用户回应（确认方案 / 确认效果 / 确认脚本跑完了 / 索取运行参数 / 等一个只有用户知道的信息），立刻调用 ${ASK_TOOL} 提问，需要选择就给 options。不要只用文字问一句就收尾。
- 如果任务确实已经全部完成，直接汇报结果并明确说"任务完成"，本轮正常结束。`

/** 当前开关（进程内权威值，启动时从磁盘读回）。 */
let active = readState()

function log(level, message) {
  try {
    const fn = globalThis.__dshQuestionModeLogger
    if (fn) fn(level, message)
  } catch {
    /* 日志失败不影响功能 */
  }
}

function readStateFile() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function readState() {
  return readStateFile()?.active === true
}

/** 提问窗口优化：true = 我们自己的卡片（默认），false = 退回原生提问卡。 */
function readOptimized() {
  const raw = readStateFile()
  return raw?.optimized !== false
}

/** 执行操作前先确认理解：默认开。 */
function readConfirmFirst() {
  const raw = readStateFile()
  return raw?.confirmFirst !== false
}

function writeState(next, optimized, confirmFirst) {
  try {
    mkdirSync(DSH_HOME, { recursive: true })
    const current = readStateFile()
    writeFileSync(
      STATE_FILE,
      `${JSON.stringify(
        {
          active: next === true,
          optimized: typeof optimized === 'boolean' ? optimized : current?.optimized !== false,
          confirmFirst: typeof confirmFirst === 'boolean' ? confirmFirst : current?.confirmFirst !== false,
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    return true
  } catch (error) {
    log('warn', `写不进状态文件 ${STATE_FILE}: ${String(error?.message ?? error)}`)
    return false
  }
}

/** 只接受同源请求：跨站页面不能替用户打开/关闭这个开关。 */
function sameOrigin(request) {
  const headers = request.headers || {}
  if (String(headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return false
  const origin = String(headers.origin || '').trim()
  if (origin === '') return true
  try {
    return new URL(origin).host === String(headers.host || '')
  } catch {
    return false
  }
}

function reply(response, body) {
  const text = JSON.stringify(body)
  response.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(text)),
  })
  response.end(text)
}

/**
 * @param ctx Cordis 插件上下文。
 */
export function apply(ctx) {
  trace('apply: question-mode 插件加载')
  try {
    globalThis.__dshQuestionModeLogger = (level, message) => {
      if (level === 'warn') ctx.logger.warn(`dsh-question-mode: ${message}`)
      else ctx.logger.info(`dsh-question-mode: ${message}`)
    }
  } catch {
    /* logger 不在就算了 */
  }

  // ── 1) 提示词段落 ────────────────────────────────────────────────
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'question-mode:policy',
        order: SECTION_ORDER,
        text: (context) =>
          active && context?.agent !== undefined
            ? readConfirmFirst()
              ? `${POLICY}\n\n${POLICY_CONFIRM}`
              : POLICY
            : '',
      }),
    'question-mode: policy section',
  )

  // ── 2) 收尾兜底 ─────────────────────────────────────────────────
  /** 这一轮里模型已经问过用户了吗（key = sessionId:turn）。 */
  const asked = new Set()
  /** 这一轮已经兜底过了（key = sessionId:turn），防止死循环。 */
  const nudged = new Set()

  const markAsked = (sessionId, turn) => {
    if (typeof turn !== 'number') return
    if (asked.size > 600) asked.clear()
    asked.add(`${sessionId}:${turn}`)
  }

  ctx.effect(
    () =>
      ctx.on('session/event', (session, event) => {
        if (!active) return
        if (event?.type !== 'tool/call') return
        if (event.data?.name !== ASK_TOOL) return
        markAsked(session.id, event.data?.turn)
      }),
    'question-mode: watch ask_user_question',
  )

  ctx.effect(
    () =>
      ctx.on('agent/turn-stopping', (payload) => {
        if (!active) return
        const agent = payload?.agent
        const turn = payload?.turn
        if (agent === undefined || typeof turn !== 'number') return
        // 子代理/工作流里的回合不插手：那里没人能回答提问。
        try {
          if (agent.session?.header?.origin === 'subagent') return
        } catch {
          /* header 读不到就照常判断 */
        }
        const sessionId = String(agent.session?.id ?? agent.id ?? '')
        if (sessionId === '') return
        const key = `${sessionId}:${turn}`
        if (asked.has(key) || nudged.has(key)) return
        if (nudged.size > 600) nudged.clear()
        try {
          agent.inject({
            id: randomUUID(),
            role: 'user',
            content: [{ type: 'text', text: NUDGE }],
            source: { kind: SOURCE_KIND },
          })
          nudged.add(key)
          log('info', `第 ${turn} 轮没有提问就准备收尾，已推一条兜底提示`)
        } catch (error) {
          log('warn', `推兜底提示失败: ${String(error?.message ?? error)}`)
        }
      }),
    'question-mode: turn-stopping nudge',
  )

  // ── 3) 给网页半边的本机路由 ─────────────────────────────────────
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: `${ROUTE}/state`,
          handler: (request, response) => {
            if (!sameOrigin(request)) {
              response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
              response.end('forbidden')
              return
            }
            reply(response, { ok: true, active, optimized: readOptimized(), confirmFirst: readConfirmFirst() })
          },
        }),
      'question-mode: state route',
    )

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: `${ROUTE}/set`,
          handler: (request, response) => {
            if (!sameOrigin(request)) {
              response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
              response.end('forbidden')
              return
            }
            const url = new URL(request.url || `${ROUTE}/set`, 'http://localhost')
            const raw = String(url.searchParams.get('active') ?? '').trim().toLowerCase()
            if (raw !== '1' && raw !== '0') {
              response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
              response.end(JSON.stringify({ ok: false, message: 'active must be 1 or 0' }))
              return
            }
            const next = raw === '1'
            active = next
            const saved = writeState(next)
            log('info', `开关 -> ${next ? '开' : '关'}（落盘${saved ? '成功' : '失败'}）`)
            reply(response, { ok: true, active, optimized: readOptimized(), saved })
          },
        }),
      'question-mode: set route',
    )

    // 提问窗口优化开关：关掉就退回原生提问卡（答案里就不带图了）
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: `${ROUTE}/optimized`,
          handler: (request, response) => {
            if (!sameOrigin(request)) {
              response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
              response.end('forbidden')
              return
            }
            const url = new URL(request.url || `${ROUTE}/optimized`, 'http://localhost')
            const raw = String(url.searchParams.get('on') ?? '').trim().toLowerCase()
            if (raw !== '1' && raw !== '0') {
              response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
              response.end(JSON.stringify({ ok: false, message: 'on must be 1 or 0' }))
              return
            }
            const saved = writeState(active, raw === '1')
            log('info', `提问窗口优化 -> ${raw === '1' ? '开' : '关'}（落盘${saved ? '成功' : '失败'}）`)
            reply(response, { ok: true, optimized: readOptimized(), saved })
          },
        }),
      'question-mode: optimized route',
    )

    // 「执行操作前先确认理解」开关
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: `${ROUTE}/confirm`,
          handler: (request, response) => {
            if (!sameOrigin(request)) {
              response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
              response.end('forbidden')
              return
            }
            const url = new URL(request.url || `${ROUTE}/confirm`, 'http://localhost')
            const raw = String(url.searchParams.get('on') ?? '').trim().toLowerCase()
            if (raw !== '1' && raw !== '0') {
              response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
              response.end(JSON.stringify({ ok: false, message: 'on must be 1 or 0' }))
              return
            }
            const saved = writeState(active, undefined, raw === '1')
            log('info', `动手前确认理解 -> ${raw === '1' ? '开' : '关'}（落盘${saved ? '成功' : '失败'}）`)
            reply(response, { ok: true, confirmFirst: readConfirmFirst(), saved })
          },
        }),
      'question-mode: confirm route',
    )

    // 客户端轮询：现在有没有挂起的提问（自己的 ask_user 工具那条通道）
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: `${ROUTE}/pending`,
          handler: (request, response) => {
            if (!sameOrigin(request)) {
              response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
              response.end('forbidden')
              return
            }
            const url = new URL(request.url || `${ROUTE}/pending`, 'http://localhost')
            const wanted = url.searchParams.get('sessionId')
            const rows = []
            for (const [callId, entry] of pendingQuestions) {
              if (wanted !== null && String(entry.sessionId ?? '') !== wanted) continue
              rows.push({ callId, questions: entry.questions, sessionId: entry.sessionId ?? '' })
            }
            reply(response, { ok: true, pending: rows })
          },
        }),
      'question-mode: pending route',
    )

    // 客户端提交答案：文本、选项、图片都在这里一次交上来
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: `${ROUTE}/answer`,
          handler: async (request, response) => {
            if (!sameOrigin(request)) {
              response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
              response.end('forbidden')
              return
            }
            try {
              let body = ''
              for await (const chunk of request) {
                body += chunk
                if (body.length > 64 * 1024 * 1024) throw new Error('payload too large')
              }
              const payload = JSON.parse(body === '' ? '{}' : body)
              const callId = String(payload.callId ?? '')
              const entry = pendingQuestions.get(callId)
              if (entry === undefined) {
                reply(response, { ok: false, message: 'no such pending question' })
                return
              }
              const answers = Array.isArray(payload.answers) ? payload.answers : []
              const images = Array.isArray(payload.images) ? payload.images : []
              const attachments = webCtx.get('attachments')
              const refs = []
              if (attachments !== undefined && images.length > 0) {
                for (const image of images) {
                  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(String(image.dataUrl ?? ''))
                  if (match === null) continue
                  try {
                    const bytes = Buffer.from(match[2], 'base64')
                    const saved = await attachments.saveImages([
                      { data: new Uint8Array(bytes), mediaType: match[1].toLowerCase() },
                    ])
                    if (Array.isArray(saved)) refs.push(...saved)
                  } catch (error) {
                    trace(`answer: 图片保存失败 ${String(error?.message ?? error)}`)
                  }
                }
              }
              entry.imageRefs.push(...refs)
              if (entry.timer !== undefined) clearTimeout(entry.timer)
              trace(`answer: call=${callId} 选项=${answers.length} 图=${refs.length}`)
              entry.resolve({ answers })
              reply(response, { ok: true, images: refs.length })
            } catch (error) {
              reply(response, { ok: false, message: String(error?.message ?? error) })
            }
          },
        }),
      'question-mode: answer route',
    )
  })

  // ── 3.5) ask_user 工具：自己这套提问（界面完全由我们的卡片渲染）──────
  ctx.inject(['tools'], (toolCtx) => {
    try {
      toolCtx.effect(
        () =>
          toolCtx.tools.register({
            name: 'ask_user',
            description:
              '向用户提问并等待回答。需要用户在方案里选一个、确认效果、提供只有他才知道的信息、或者让他先跑一下脚本再回报时用它。可以一次带多个问题（用户能翻页逐题回答），每题可给 2-4 个选项，用户也能直接在输入框里打字回答、贴图。',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['questions'],
              properties: {
                questions: {
                  type: 'array',
                  description: '要问的问题，按顺序显示，用户可以逐页回答。',
                  items: {
                    type: 'object',
                    additionalProperties: true,
                    required: ['id', 'question'],
                    properties: {
                      id: { type: 'string', description: '这一题的唯一 id，回答里会原样带回来。' },
                      header: { type: 'string', description: '小标题（短）。' },
                      question: { type: 'string', description: '问题本身。' },
                      detail: { type: 'string', description: '可选的补充说明。' },
                      multi_select: { type: 'boolean', description: '是否允许多选。' },
                      options: {
                        type: 'array',
                        description: '可选项；不给就退化成纯文本回答。',
                        items: {
                          type: 'object',
                          additionalProperties: true,
                          required: ['label'],
                          properties: {
                            label: { type: 'string', description: '选项文字。' },
                            description: { type: 'string', description: '选项的补充说明。' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            output: {
              schema: { type: 'object', additionalProperties: true },
              render: (_args, value) => {
                const blocks = [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      answers: value?.answers ?? [],
                      images: Array.isArray(value?.images) ? value.images.length : 0,
                      ...(value?.timedOut === true ? { timedOut: true } : {}),
                    }),
                  },
                ]
                const images = Array.isArray(value?.images) ? value.images : []
                for (const ref of images) {
                  try {
                    blocks.push({ type: 'image', attachment: ref })
                  } catch {
                    /* 图块拼不出来就只给文本，别把整次结果弄挂 */
                  }
                }
                return blocks
              },
            },
            execute: (args, exec) =>
              new Promise((resolve, reject) => {
                const raw = Array.isArray(args?.questions) ? args.questions : []
                const questions = raw
                  .map((item, i) => ({
                    id: String(item?.id ?? `q${i + 1}`),
                    header: typeof item?.header === 'string' ? item.header : '',
                    question: typeof item?.question === 'string' ? item.question : '',
                    detail: typeof item?.detail === 'string' ? item.detail : '',
                    options: Array.isArray(item?.options)
                      ? item.options
                          .filter((option) => typeof option?.label === 'string' && option.label.trim() !== '')
                          .map((option) => ({
                            label: option.label,
                            description: typeof option.description === 'string' ? option.description : '',
                          }))
                      : [],
                    multiSelect: item?.multi_select === true,
                  }))
                  .filter((item) => item.question !== '')
                if (questions.length === 0) {
                  return reject(new Error('questions 至少要有一道有内容的问题'))
                }
                // 只在「提问窗口优化」关掉时才交给原生提问卡；拿不到原生服务就照旧用自己的
                if (readOptimized() === false) {
                  const native = toolCtx.get('userQuestions')
                  if (native !== undefined && native !== null && typeof native.ask === 'function') {
                    trace('ask_user: 优化已关，走原生卡片')
                    native
                      .ask({
                        questions: questions.map((item) => ({
                          id: item.id,
                          question: item.question,
                          ...(item.header === '' ? {} : { header: item.header }),
                          ...(item.detail === '' ? {} : { detail: item.detail }),
                          ...(item.options.length === 0 ? {} : { options: item.options }),
                          ...(item.multiSelect === true ? { multi_select: true } : {}),
                        })),
                        agent: exec?.agent,
                      })
                      .then((result) => {
                        resolve({
                          answers: Array.isArray(result?.answers) ? result.answers : [],
                          images: [],
                        })
                      })
                      .catch((error) => reject(error))
                    return
                  }
                  trace('ask_user: 优化已关但拿不到原生提问服务，退回自己的卡片')
                }
                const callId = String(exec?.callId ?? randomUUID())
                let sessionId = ''
                try {
                  sessionId = String(exec?.session?.id ?? exec?.agent?.session?.id ?? '')
                } catch {
                  sessionId = ''
                }
                const entry = { questions, sessionId, imageRefs: [], resolve: null, timer: undefined }
                entry.resolve = (payload) => {
                  if (entry.timer !== undefined) clearTimeout(entry.timer)
                  pendingQuestions.delete(callId)
                  resolve({
                    answers: Array.isArray(payload?.answers) ? payload.answers : [],
                    images: entry.imageRefs.slice(),
                  })
                }
                pendingQuestions.set(callId, entry)
                trace(`ask_user: 挂起 call=${callId} 题=${questions.length}`)
                entry.timer = setTimeout(() => {
                  if (!pendingQuestions.has(callId)) return
                  entry.timer = undefined
                  pendingQuestions.delete(callId)
                  trace(`ask_user: 超时 call=${callId}`)
                  resolve({ answers: [], images: [], timedOut: true })
                }, 10 * 60 * 1000)
              }),
          }),
        'question-mode: ask_user tool',
      )
      trace('ask_user: 注册成功')
    } catch (error) {
      trace(`ask_user: 注册失败 ${String(error?.message ?? error)}`)
    }
  })

  // ── 4) /ask 命令（键盘路径，开关坏了也能用）─────────────────────
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.effect(
      () =>
        commandCtx.commands.register({
          definitionId: 'dsh-question-mode',
          name: 'ask',
          description: '开关提问模式：做完一步别结束对话，先向你提问',
          input: { hint: '[on|off]' },
          handler: ({ rawInput }) => {
            const arg = String(rawInput ?? '').trim().toLowerCase()
            const next = arg === 'on' ? true : arg === 'off' ? false : !active
            active = next
            const saved = writeState(next)
            return {
              kind: 'success',
              text: next
                ? `提问模式：开。以后做完一步会先问你，不再直接结束本轮。${saved ? '' : '（状态没写进磁盘，重启后可能回到默认）'}`
                : '提问模式：关。恢复默认行为。',
            }
          },
        }),
      'question-mode: /ask command',
    )
  })
}
