// dsh-question-mode · 网页半边
//
// 在输入框工具行（`+` / 权限 / 计划 那一排）塞两个开关样的控件：
//   1) 「提问模式」── 状态在宿主半边（$DSH_HOME/question-mode.json），这里只读写；
//   2) 「测试按钮」── 跟提问模式长得一模一样，但状态只在这一份组件里（纯本地）。
//
// 设置页里的开关统一用 BigSwitch（44×26 轨道 + 20px 圆点），别单独改样式。

window.__ModuleLoader__.load({
  id: 'dsh-question-mode',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    // 浮层要 portal 到 body：composer 里有 transform/overflow，position:fixed 会被关在里面
    let ReactDOM = null
    try {
      ReactDOM = require('react-dom')
    } catch {
      ReactDOM = null
    }
    const portal = (node) =>
      ReactDOM !== null && typeof ReactDOM.createPortal === 'function'
        ? ReactDOM.createPortal(node, document.body)
        : node

    /** 词条命名空间（和宿主同名，方便一眼对上）。 */
    const NS = 'question-mode'
    const ROUTE = '/dsh-question-mode'

    const zh = {
      'label': '提问模式',
      'title.on': '提问模式已开启：做完一步会先向你提问 · 点击关闭',
      'title.off': '提问模式已关闭 · 点击开启',
      'title.busy': '正在切换…',
      'failed': '切换失败，宿主没接住这次请求',
      'attach.image': '图{n}',
      'attach.file': '文件',
      'attach.remove': '删除',
      'float.header': '提问',
      'float.skip': '跳过',
      'float.prev': '上一题',
      'float.next': '下一题',
      'float.nextQuestion': '下一题',
      'float.collapse': '收起',
      'float.expand': '展开',
      'float.submit': '提交答案',
      'setting.brand': 'NQE｜原生提问增强',
      'setting.brand.sub': 'Native Question Enhancer',
      'setting.ask.title': '提问模式',
      'setting.ask.desc': '打开后，我需要你确认或选择时会直接提问，而不是结束对话。',
      'setting.opt.title': '提问窗口优化',
      'setting.opt.desc': '打开 = 用插件自己的提问面板（可翻页、可贴图）；关闭 = 退回系统原生提问卡片。',
      'setting.autoNext.title': '选择答案后自动翻页',
      'setting.confirm.title': '执行操作前向用户确认理解是否正确',
    }

    const en = {
      'label': 'Ask mode',
      'title.on': 'Ask mode is on: finish a step, then ask you instead of ending · click to turn off',
      'title.off': 'Ask mode is off · click to turn on',
      'title.busy': 'Switching…',
      'failed': 'Switch failed: the host did not answer',
      'attach.image': 'Image {n}',
      'attach.file': 'File',
      'attach.remove': 'Remove',
      'float.header': 'Question',
      'float.skip': 'Skip',
      'float.prev': 'Previous question',
      'float.next': 'Next question',
      'float.nextQuestion': 'Next',
      'float.collapse': 'Collapse',
      'float.expand': 'Expand',
      'float.submit': 'Submit answer',
      'setting.brand': 'NQE',
      'setting.brand.sub': 'Native Question Enhancer',
      'setting.ask.title': 'Ask mode',
      'setting.ask.desc': 'When on, I ask you instead of ending the turn whenever I need a confirmation or a choice.',
      'setting.opt.title': 'Question window optimization',
      'setting.opt.desc': 'On = the plugin question panel (paging, image attachments). Off = the built-in question card.',
      'setting.autoNext.title': 'Advance automatically after choosing',
      'setting.confirm.title': 'Confirm my understanding before acting',
    }

    /** 读一次宿主的提问模式状态。 */
    function readAskMode() {
      return fetch(`${ROUTE}/state`, { cache: 'no-store' }).then((response) => response.json())
    }

    /** 写一次宿主的提问模式状态。 */
    function writeAskMode(next) {
      return fetch(`${ROUTE}/set?active=${next ? 1 : 0}`, { cache: 'no-store' }).then((response) =>
        response.json(),
      )
    }

    /** 写一次「执行操作前向用户确认理解是否正确」。 */
    function writeConfirm(next) {
      return fetch(`${ROUTE}/confirm?on=${next ? 1 : 0}`, { cache: 'no-store' }).then((response) =>
        response.json(),
      )
    }

    /** 写一次「提问窗口优化」开关（关掉就走原生提问卡）。 */
    function writeOptimized(next) {
      return fetch(`${ROUTE}/optimized?on=${next ? 1 : 0}`, { cache: 'no-store' }).then((response) =>
        response.json(),
      )
    }


    // ────────────────────────────────────────────────────────────────
    // 浮层问答（测试按钮 = 开关）
    //   原生提问卡占 `conversation.composer` 链座位，选中就把原生输入框 display:none。
    //   这里改成：抢在原生之前接下 `user-questions/request`，自己渲染一个贴着
    //   输入框向上弹出的浮层，原生输入框原地保留（能贴图、能挂文件）。
    //   ⚠ 开关关掉 = 原生卡片，坏了一键退回。
    // ────────────────────────────────────────────────────────────────
    /** 选择答案后自动翻页（提问窗口优化的额外设置）。 */
    let autoNext = false
    try {
      autoNext = localStorage.getItem('dsh-question-mode.autoNext') === '1'
    } catch {
      autoNext = false
    }
    const rememberAutoNext = (next) => {
      autoNext = next === true
      try {
        localStorage.setItem('dsh-question-mode.autoNext', autoNext ? '1' : '0')
      } catch {
        /* 存不了就算了 */
      }
    }

    /** 提问面板样式：true = 极简（不画背景），false = 卡片（默认）。 */
    let cardPlain = false
    try {
      cardPlain = localStorage.getItem('dsh-question-mode.plain') === '1'
    } catch {
      cardPlain = false
    }

    /** 设置页那一行的小字：现在到底走哪条路。 */
    let hookState = cardPlain
      ? '提问面板样式：极简（无背景）'
      : '提问面板样式：卡片（带背景）'
    const rememberFloat = (next) => {
      cardPlain = next
      try {
        localStorage.setItem('dsh-question-mode.plain', next ? '1' : '0')
      } catch {
        /* 存不了就算了 */
      }
      hookState = next ? '提问面板样式：极简（无背景）' : '提问面板样式：卡片（带背景）'
    }

    /**
     * 从输入框的 DOM 直接读草稿文本。
     * 比 `useInput` 可靠：不依赖 InputState 的字段形状，也不受 React 订阅时机影响。
     */
    function readComposerText() {
      try {
        const seat = document.querySelector('[data-composer-seat]')
        if (seat === null) return ''
        // 原生编辑器可能是 contenteditable="true"、"" 或 "plaintext-only"，统一按属性找
        const editor =
          seat.querySelector('[contenteditable]:not([contenteditable="false"])') ??
          seat.querySelector('[role="textbox"]')
        if (editor === null) return ''
        const text = editor.innerText ?? editor.textContent ?? ''
        return typeof text === 'string' ? text : ''
      } catch {
        return ''
      }
    }

    /**
     * 这颗按钮是不是输入框右下角那颗发送键。
     * 优先看 aria-label（原生用 `input.send` / `input.send.steer`，中英文都含 send / 发送），
     * 再看几何：座位右 30% + 圆形 + 尺寸 20–56。
     */
    function isSendButton(button, seat, allowStop = false) {
      const label = `${button.getAttribute('aria-label') ?? ''} ${button.getAttribute('title') ?? ''}`.toLowerCase()
      if (label.includes('停止') || label.includes('stop')) return allowStop
      if (label.includes('发送') || label.includes('send')) return true
      const rect = button.getBoundingClientRect()
      const seatRect = seat.getBoundingClientRect()
      if (rect.width < 20 || rect.width > 56) return false
      if (rect.left < seatRect.left + seatRect.width * 0.7) return false
      const style = window.getComputedStyle(button)
      const radiusText = style.borderTopLeftRadius ?? ''
      if (radiusText.includes('50%')) return true
      const radius = Number.parseFloat(radiusText)
      return Number.isFinite(radius) && radius >= rect.width / 2 - 2
    }

    /** 一个问题的草稿：选了哪个 / 是否跳过 / 自定义文本。 */
    const emptyDraft = () => ({ selected: [], custom: '', skipped: false })

    /** 草稿里的附件（DraftAttachmentBar 每次渲染同步过来），提交答案时要用。 */
    let draftAttachments = []

    /** 把 File 读成 dataURL。 */
    function toDataUrl(file) {
      return new Promise((resolve) => {
        try {
          const reader = new FileReader()
          reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
          reader.onerror = () => resolve(null)
          reader.readAsDataURL(file)
        } catch {
          resolve(null)
        }
      })
    }

    /** 给任意 promise 加个上限：上传/网络问题绝不能把整个提交卡死。 */
    function withTimeout(promise, ms) {
      return Promise.race([
        Promise.resolve(promise).catch(() => false),
        new Promise((resolve) => setTimeout(() => resolve(false), ms)),
      ])
    }

    /**
     * 自己的提问面板宿主：轮询 `/pending`，有活就渲染卡片。
     * 挂在 `conversation.input.dock` 座位上（输入框正上方），**参与布局** ——
     * 卡片出现时消息区上移，不会遮挡；原生输入框原样保留，贴图/挂文件/发指令都照常。
     */
    function QuestionDock(props) {
      const t = props.t === undefined ? (key) => key : props.t
      const [pending, setPending] = React.useState(null)
      // 只显示当前会话的提问：别的会话挂起的卡不在这里弹
      const sessionId = props.sessionId

      React.useEffect(() => {
        let alive = true
        const tick = async () => {
          try {
            const response = await fetch(`${ROUTE}/pending`, { cache: 'no-store' })
            const value = await response.json()
            if (!alive) return
            const rows = Array.isArray(value?.pending) ? value.pending : []
            const first = rows.find((row) => row.sessionId === sessionId) ?? (sessionId === undefined ? rows[0] : undefined)
            setPending((prev) => {
              const prevId = prev?.callId ?? ''
              const nextId = first?.callId ?? ''
              if (prevId === nextId && prev !== null) return prev
              return first === undefined ? null : { callId: nextId, questions: first.questions }
            })
          } catch {
            /* 下一次再试 */
          }
        }
        void tick()
        const timer = setInterval(() => void tick(), 800)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [])

      if (pending === null) return null
      // inputActions 必须透传：清草稿/摘附件都靠它（不传的话 props.inputActions 是 undefined，
      // 清理那一步就静默什么都没做 —— 这就是「图1」一直残留的原因）
      return h(AskCard, {
        pending,
        t,
        useInput: props.useInput,
        inputActions: props.inputActions,
        plain: cardPlain,
      })
    }

    /**
     * 提交答案给自己那套 ask_user（可以带图，图随答案同一条 tool result 到模型）。
     */
    async function postOwnAnswer(callId, answer, attachments) {
      const id = String(callId ?? '')
      if (id === '') return false
      const images = []
      if (Array.isArray(attachments)) {
        for (const item of attachments) {
          const file = item?.file
          if (!String(file?.type ?? '').startsWith('image/')) continue
          const dataUrl = await toDataUrl(file)
          if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
            images.push({ dataUrl })
          }
        }
      }
      try {
        const response = await fetch(`${ROUTE}/answer`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ callId: id, answers: answer?.answers ?? [], images }),
        })
        const value = await response.json()
        return value?.ok === true
      } catch {
        return false
      }
    }

    /**
     * 提交之后把下方原生输入框的草稿清掉。
     *
     * 输入草稿没有公开的写接口，而且编辑器是框架接管的（会拦截 DOM 变更再同步回状态），
     * 所以要走它自己的入口：聚焦 → 全选 → `beforeinput(deleteContentBackward)`
     * → `execCommand('delete')` → 通知 `input`。哪一步奏效都行，最后再兜一次 DOM 清空。
     */
    function clearComposerDraft() {
      try {
        const seat = document.querySelector('[data-composer-seat]')
        if (seat === null) return
        const editor =
          seat.querySelector('[contenteditable]:not([contenteditable="false"])') ??
          seat.querySelector('[role="textbox"]')
        if (editor === null) return

        if (typeof editor.focus === 'function') editor.focus()

        const selection = window.getSelection()
        if (selection === null) return
        const range = document.createRange()
        range.selectNodeContents(editor)
        selection.removeAllRanges()
        selection.addRange(range)

        const fire = (type, inputType) => {
          try {
            const event = new InputEvent(type, { inputType, bubbles: true, cancelable: true })
            editor.dispatchEvent(event)
          } catch {
            /* 环境不支持 InputEvent 就算了 */
          }
        }

        fire('beforeinput', 'deleteContentBackward')
        // insertText('') 会用空串替换选区 —— 对 Lexical 这类框架最有效：
        // 它自己会监听 DOM 的 input 事件并把 state 同步掉。
        try {
          document.execCommand('insertText', false, '')
        } catch {
          /* 不支持 insertText 的环境继续往下试 */
        }
        try {
          document.execCommand('delete')
        } catch {
          /* 老路径失败不影响后面的兜底 */
        }
        fire('input', 'deleteContentBackward')

        // 兜底：DOM 里还剩字就直接清掉，再通知一次编辑器
        const left = editor.innerText ?? editor.textContent ?? ''
        if (typeof left === 'string' && left.trim() !== '') {
          editor.textContent = ''
          fire('input', 'deleteContentBackward')
        }
        selection.removeAllRanges()
      } catch {
        /* 清不掉就算了，不影响答案 */
      }
    }

    /**
     * 每张提问卡的草稿缓存：`key → drafts[]`。
     * 卡片会因为链座位重选而重新挂载（比如输入框一有变化），
     * 只放在组件 state 里的话，已经勾好的选项就会丢 —— 这就是「选了选项再打字，
     * 提交时选项没挂上」的原因。状态放模块级，按卡片的 key 索引。
     */
    const draftCache = new Map()

    /**
     * 提问卡本体（我们自己的那张，占 `conversation.composer` 链座位）。
     * 按你的要求：没有「输入你的回答」区；页码在标题右边；提交换成原生那个蓝色圆发送键；
     * 「跳过」跟在页码后面。答题数据来自座位注入的 `matched`（原生 PendingQuestion）。
     */
    function AskCard(props) {
      const t = props.t === undefined ? (key) => key : props.t
      const pending = props.pending ?? props.matched
      /** 极简样式（设置页那个开关）：不画背景，只留文字和按钮。 */
      const plain = props.plain === true
      const questions = Array.isArray(pending?.questions) ? pending.questions : []
      const cacheKey = typeof pending?.key === 'string' ? pending.key : String(pending?.callId ?? '')
      const [index, setIndex] = React.useState(0)
      const [drafts, setDraftsRaw] = React.useState(
        () => draftCache.get(cacheKey) ?? questions.map(() => emptyDraft()),
      )
      /** 写入草稿的同时同步缓存，重新挂载也能接着填。 */
      const setDrafts = (next) => {
        setDraftsRaw((prev) => {
          const value = typeof next === 'function' ? next(prev) : next
          if (cacheKey !== '') draftCache.set(cacheKey, value)
          return value
        })
      }
      const [busy, setBusy] = React.useState(false)
      /** 已经交出去了：立刻从屏幕上撤掉卡片（宿主清掉挂起状态可能晚一拍）。 */
      const [done, setDone] = React.useState(false)
      /** 折叠：只留标题行，内容收起来（右上角那个按钮）。 */
      const [collapsed, setCollapsed] = React.useState(false)
      const bodyRef = React.useRef(null)
      /** 内容区的实测高度：折叠动画用具体像素值，比 max-height: 900px 那条长距离过渡顺得多。 */
      const [bodyHeight, setBodyHeight] = React.useState(0)
      const rootRef = React.useRef(null)
      const [box, setBox] = React.useState(null)
      /** 原生那颗键的位置（答完题没打字时它是「停止」，我们要在上面盖一个圆形提交键）。 */
      const [sendRect, setSendRect] = React.useState(null)
      /** 重测一次原生键位置（选完选项后立刻调，不用等定时器）。 */
      const measureRef = React.useRef(null)
      /** 已经选过选项/跳过题了（输入框即使空，也允许点那颗键提交）。 */
      const anyAnsweredRef = React.useRef(false)
      /** 提交函数（每渲染更新一次），供 document 级拦截复用。 */
      const submitRef = React.useRef(null)
      /** 输入框草稿的最新值（document 级监听只能通过 ref 拿到它）。 */
      const composerTextRef = React.useRef('')

      // 输入框那一侧的「发送」也算回答：
      //   · 在输入框里按 Enter（不带 Shift）
      //   · 点右下角那颗圆形发送键（原生 aria-label 就是「发送消息」/「插话发送」）
      // 在 document 捕获阶段拦下来（早于 React 的 root 委托），改成提交本题答案。
      // ⚠ 草稿从 DOM 读，不依赖 useInput 的字段形状 —— 那个曾经让整条拦截失效。
      React.useEffect(() => {
        const seatOf = () => document.querySelector('[data-composer-seat]')
        const draft = () => readComposerText()
        /**
         * 一次点击会依次产生 pointerdown / mousedown / pointerup / mouseup / click。
         * 只在 pointerdown 拦，原生如果在 pointerup 或 click 上发送，就会漏成一条插话。
         * 所以提交后开一个 500ms 的静默窗口，把同一次交互剩下的指针事件全吞掉。
         */
        let silenceUntil = 0
        const silence = () => {
          silenceUntil = Date.now() + 500
        }
        const swallow = (event) => {
          if (Date.now() > silenceUntil) return
          const seat = seatOf()
          if (seat === null) return
          if (!(event.target instanceof Element) || !seat.contains(event.target)) return
          event.preventDefault()
          event.stopPropagation()
        }

        const onKey = (event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
          if (event.ctrlKey || event.metaKey) return
          const seat = seatOf()
          if (seat === null) return
          if (!(event.target instanceof Element) || !seat.contains(event.target)) return
          const text = draft().trim()
          const answeredAny = anyAnsweredRef.current === true
          if (text === '' && !answeredAny) return
          event.preventDefault()
          event.stopPropagation()
          silence()
          submitRef.current?.()
        }

        const onPointer = (event) => {
          if (Date.now() <= silenceUntil) {
            swallow(event)
            return
          }
          const seat = seatOf()
          if (seat === null) return
          if (!(event.target instanceof Element)) return
          const button = event.target.closest('button, [role="button"]')
          if (button === null || !seat.contains(button)) return
          // 没有草稿时就别抢「发送」键 —— 但选过答案时要抢：
          // 此时那颗键是「停止」，用户点它本来是想提交答案。
          const text = draft().trim()
          const answeredAny = anyAnsweredRef.current === true
          if (text === '' && !answeredAny) return
          if (!isSendButton(button, seat, text === '')) return
          event.preventDefault()
          event.stopPropagation()
          silence()
          submitRef.current?.()
        }

        const types = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'pointercancel']
        const listeners = types.map((type) => [type, type === 'pointerdown' || type === 'click' ? onPointer : swallow])
        // ⚠ 必须挂在 window 的捕获阶段：事件流是 window → document → … → target。
        //    挂在 document 上时，若原生把发送处理挂在 window 捕获（或任何更早的层），
        //    我们就会晚一步 —— 插话已经发出去了，然后再额外提交一次答案（就是“两个都发”）。
        window.addEventListener('keydown', onKey, true)
        for (const [type, handler] of listeners) window.addEventListener(type, handler, true)
        return () => {
          window.removeEventListener('keydown', onKey, true)
          for (const [type, handler] of listeners) window.removeEventListener(type, handler, true)
        }
      }, [])
      // 输入框里的草稿：提交时当作本题的自定义回答（这就是「在输入框里打字 = 回答」）
      const useInputState = props.useInput === undefined ? () => undefined : props.useInput
      const inputState = useInputState((state) => state)
      const composerText = typeof inputState?.text === 'string' ? inputState.text : ''
      composerTextRef.current = composerText

      // 跟输入框那张卡对齐：座位里套了两层 display:contents 外壳，
      // 必须逐层往下找到第一个“真的有盒子”的元素（composerStack），量它的宽和左偏移。
      // 顺便兜底：如果样式表的 :has() 没生效（座位不是 flex），就地补三条内联样式，
      // 保证卡片一定翻到输入框上面；卸载时还原。
      React.useLayoutEffect(() => {
        let patched = null
        const patchSeat = (seat) => {
          if (patched !== null || seat.style === undefined) return
          const display =
            typeof window.getComputedStyle === 'function'
              ? window.getComputedStyle(seat)?.display
              : undefined
          if (display === 'flex') return
          patched = {
            display: seat.style.display,
            flexDirection: seat.style.flexDirection,
            gap: seat.style.gap,
          }
          seat.style.display = 'flex'
          seat.style.flexDirection = 'column-reverse'
          seat.style.gap = '8px'
        }
        const measure = () => {
          const seat = document.querySelector('[data-composer-seat]')
          if (seat === null) return
          patchSeat(seat)
          // 量「输入框那张圆角卡」本身：从可编辑区往上找第一个
          // 宽度够大（>400）且圆角 >=8 的容器 —— 那才是用户眼里的输入框。
          // 量外层 stack 会把左右 padding 也算进来，卡片就会比输入框宽出去一截。
          let target = null
          const editor =
            seat.querySelector('[contenteditable]:not([contenteditable="false"])') ??
            seat.querySelector('[role="textbox"]')
          if (editor !== null && editor !== undefined) {
            let element = editor
            while (element !== null && element !== undefined && element !== seat) {
              if (typeof element.getBoundingClientRect !== 'function') break
              const rect = element.getBoundingClientRect()
              const style = window.getComputedStyle(element)
              const radius = Number.parseFloat(style.borderTopLeftRadius ?? '0')
              if (rect.width > 400 && Number.isFinite(radius) && radius >= 8) {
                target = { element, rect }
                break
              }
              element = element.parentElement
            }
          }
          if (target === null) {
            const queue = [...seat.children]
            while (queue.length > 0) {
              const element = queue.shift()
              if (element.getAttribute('data-question-mode-card') !== null) continue
              const rect = element.getBoundingClientRect()
              if (rect.width > 0 && rect.height > 1) {
                target = { element, rect }
                break
              }
              queue.push(...element.children)
            }
          }
          if (target === null) return
          setBox({ width: target.rect.width, left: target.rect.left })
          // 量原生那颗键：没有草稿时它是「停止」，选完选项就点不到提交，所以盖一个圆键上去
          let key = null
          try {
            for (const candidate of seat.querySelectorAll('button, [role="button"]')) {
              if (!isSendButton(candidate, seat, true)) continue
              const rect = candidate.getBoundingClientRect()
              if (rect.width > 0 && rect.height > 0) {
                const label = `${candidate.getAttribute('aria-label') ?? ''} ${candidate.getAttribute('title') ?? ''}`
                const isStop = /停止|stop/i.test(label)
                const visible =
                  isStop && (readComposerText().trim() !== '' || anyAnsweredRef.current === true)
                // 盖上去时把原生那颗藏掉，否则它自己的形状会从我们的圆边露出来
                try {
                  if (visible) {
                    if (candidate.style.visibility !== 'hidden') {
                      candidate.dataset.questionModeHidden = candidate.style.visibility
                      candidate.style.visibility = 'hidden'
                    }
                  } else if (candidate.dataset.questionModeHidden !== undefined) {
                    candidate.style.visibility = candidate.dataset.questionModeHidden
                    delete candidate.dataset.questionModeHidden
                  }
                } catch {
                  /* 藏不住就算了 */
                }
                key = {
                  cx: rect.left + rect.width / 2,
                  cy: rect.top + rect.height / 2,
                  visible,
                }
                break
              }
            }
          } catch {
            key = null
          }
          // 找不到（React 正在换节点）时保持原状，避免覆盖层闪一下
          if (key !== null) {
            setSendRect((prev) =>
              prev !== null && prev !== undefined && prev.cx === key.cx && prev.cy === key.cy && prev.visible === key.visible
                ? prev
                : key,
            )
          }
        }
        measureRef.current = measure
        measure()
        const seat = document.querySelector('[data-composer-seat]')
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
        if (observer !== null && seat !== null) observer.observe(seat)
        window.addEventListener('resize', measure)
        // 那颗键会在「发送 ↔ 停止」之间切换，定时重量
        const keyTimer = setInterval(measure, 120)
        return () => {
          measureRef.current = null
          clearInterval(keyTimer)
          try {
            const currentSeat = document.querySelector('[data-composer-seat]')
            if (currentSeat !== null) {
              for (const element of currentSeat.querySelectorAll('[data-question-mode-hidden]')) {
                element.style.visibility = element.dataset.questionModeHidden ?? ''
                delete element.dataset.questionModeHidden
              }
            }
          } catch {
            /* 忽略 */
          }
          if (observer !== null) observer.disconnect()
          window.removeEventListener('resize', measure)
          const current = document.querySelector('[data-composer-seat]')
          if (patched !== null && current !== null && current.style !== undefined) {
            current.style.display = patched.display
            current.style.flexDirection = patched.flexDirection
            current.style.gap = patched.gap
          }
        }
      }, [])

      React.useEffect(() => {
        const cached = draftCache.get(cacheKey)
        setDraftsRaw(cached ?? questions.map(() => emptyDraft()))
        setIndex(0)
        setDone(false)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [cacheKey, questions.length])

      // ── 接管输入框那颗发送键 ──────────────────────────────────────
      // 只靠事件拦截不够：原生若把发送挂在 window 捕获且注册得比我们早，
      // 插话会先发出去，我们再补一个答案 → “两个都发”。
      // 所以直接在发送键上方盖一个透明按钮：事件落不到原生按钮上，它就不可能发送。
      // 草稿为空时立刻撤掉（那时那颗键是「停止」，不能挡）。
      React.useLayoutEffect(() => {
        let last = ''
        const update = () => {
          const seat = document.querySelector('[data-composer-seat]')
          if (seat === null) {
            if (last !== '') {
              last = ''
              setSendRect(null)
            }
            return
          }
          // 提问挂起时：打了字或选过选项，那颗键就当作「提交答案」。
          // 没有挂起提问时卡片根本不渲染，所以不影响平时发消息。
          const hasDraft = readComposerText().trim() !== ''
          const ready = hasDraft || anyAnsweredRef.current === true
          let found = null
          if (ready) {
            for (const candidate of seat.querySelectorAll('button, [role="button"]')) {
              if (isSendButton(candidate, seat, !hasDraft)) {
                found = candidate
                break
              }
            }
          }
          if (found === null) {
            if (last !== '') {
              last = ''
              setSendRect(null)
            }
            return
          }
          const rect = found.getBoundingClientRect()
          const next = `${rect.left}|${rect.top}|${rect.width}|${rect.height}`
          if (next === last) return
          last = next
          setSendRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
        }
        update()
        const timer = setInterval(update, 250)
        window.addEventListener('scroll', update, true)
        window.addEventListener('resize', update)
        return () => {
          clearInterval(timer)
          window.removeEventListener('scroll', update, true)
          window.removeEventListener('resize', update)
        }
      }, [pending?.key])

      if (done) return null
      if (pending === undefined || pending === null || questions.length === 0) return null

      const safeIndex = Math.min(index, questions.length - 1)
      const current = questions[safeIndex]
      const draft = drafts[safeIndex] ?? emptyDraft()
      const options = Array.isArray(current.options) ? current.options : []
      const update = (patch) => {
        setDrafts((all) => all.map((item, i) => (i === safeIndex ? { ...item, ...patch } : item)))
      }
      const choose = (label) => {
        // 本页之前有没有已经答过（选过选项 / 填过字）
        const wasAnswered = draft.selected.length > 0 || draft.custom.trim() !== ''
        if (current.multiSelect === true) {
          const has = draft.selected.includes(label)
          update({ selected: has ? draft.selected.filter((x) => x !== label) : [...draft.selected, label] })
        } else {
          update({ selected: [label] })
        }
        // 只在「本页第一次选」时自动翻页；换答案不动
        if (autoNext === true && wasAnswered === false && safeIndex < questions.length - 1) {
          setIndex(safeIndex + 1)
        }
      }
      const answered = (item) => item.skipped || item.selected.length > 0 || item.custom.trim() !== ''
      // 选过任何一题（含跳过）就允许用那颗键提交
      anyAnsweredRef.current = drafts.some(
        (item) => item !== undefined && (item.skipped || item.selected.length > 0 || item.custom.trim() !== ''),
      )
      /** 能不能提交：选过/跳过任何一题，或输入框里有字。都没有时按钮是灰的、点不动。 */
      const canSubmit = anyAnsweredRef.current || readComposerText().trim() !== ''

      // 选完选项 / 换页后立刻重测一次原生键位置 —— 不用等 120ms 的定时器
      React.useEffect(() => {
        measureRef.current?.()
      }, [drafts, index])

      // 量一下内容区真实高度，折叠时就用这个精确值做过渡（换成具体像素，动画才顺）
      React.useEffect(() => {
        const element = bodyRef.current
        if (element === null || element === undefined) return undefined
        const measure = () => {
          try {
            setBodyHeight(element.scrollHeight)
          } catch {
            /* 量不到就用兜底值 */
          }
        }
        measure()
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
        observer?.observe(element)
        return () => observer?.disconnect()
      }, [safeIndex, questions.length, collapsed])

      const submit = () => {
        if (busy) return
        setBusy(true)
        // 文本回答：DOM 里真实的草稿优先，useInput 的镜像只作兜底
        const liveText = readComposerText()
        const typedText = liveText.trim() === '' ? composerText : liveText
        // 草稿里有没有图/文件（决定提交时是否顺带把图交给宿主）
        const hadAtt =
          (Array.isArray(draftAttachments) && draftAttachments.length > 0) ||
          (() => {
            try {
              const seat = document.querySelector('[data-composer-seat]')
              return seat !== null && seat.querySelector('[data-question-mode-attachments]') !== null
            } catch {
              return false
            }
          })()
        const answer = {
          answers: questions.map((item, i) => {
            const value = drafts[i] ?? emptyDraft()
            if (value.skipped) return { id: item.id, selected: [] }
            const fromComposer = i === safeIndex ? typedText : ''
            const custom = (value.custom === '' ? fromComposer : value.custom).trim()
            // 选中的选项与输入框里的补充文本可以同时作为答案（原生的做法是二选一，会丢东西）
            return {
              id: item.id,
              selected: value.selected,
              ...(custom === '' ? {} : { custom }),
            }
          }),
        }
        const deliver = () =>
          Promise.resolve(
            typeof pending.answer === 'function'
              ? pending.answer(answer)
              : postOwnAnswer(pending?.callId, answer, draftAttachments),
          )
            .then(() => {
              setDone(true)
              if (cacheKey !== '') draftCache.delete(cacheKey)
              clearComposerDraft()
              // 附件已经在答案里交给宿主了，草稿里逐个摘掉（prune 的时序不可靠）
              try {
                const actions = props.inputActions
                const list = Array.isArray(draftAttachments) ? [...draftAttachments] : []
                if (actions !== undefined && actions !== null && typeof actions.removeAttachment === 'function') {
                  for (const item of list) actions.removeAttachment(item.id)
                } else {
                  actions?.pruneAttachments?.([])
                }
                draftAttachments = []
              } catch {
                /* 拿不到就留着 */
              }
              // 再补一刀：有的实现要等一帧才反映删除
              setTimeout(() => {
                try {
                  if (draftAttachments.length > 0) {
                    for (const item of [...draftAttachments]) props.inputActions?.removeAttachment?.(item.id)
                    draftAttachments = []
                  }
                } catch {
                  /* 忽略 */
                }
              }, 200)
            })
            .catch(() => {})
            .finally(() => setBusy(false))

        // 自己的通道（ask_user 工具）：图随答案一起 POST，不进输入框、不算插话。
        // 只有走原生 PendingQuestion 时，才退回「先上传再挂 tool result」那条老路。
        void (async () => {
          if (typeof pending.answer === 'function') {
            await deliver()
            return
          }
          await deliver()
        })()
      }
      submitRef.current = submit
      const skip = () => {
        update({ skipped: true, selected: [] })
        if (safeIndex < questions.length - 1) setIndex(safeIndex + 1)
        else submit()
      }

      const pagerButton = (glyph, disabled, onClick, label) =>
        h('button', {
          type: 'button',
          'aria-label': label,
          disabled,
          onClick,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            border: 'none',
            borderRadius: 8,
            background: 'transparent',
            color: 'var(--dsw-alias-label-secondary)',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.35 : 1,
            padding: 0,
            fontSize: 18,
            lineHeight: '24px',
            outline: 'none',
          },
        }, glyph)

      return h(
        React.Fragment,
        null,
        h('div', {
          'data-question-mode-card': '',
          ref: rootRef,
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: plain === true ? '4px 2px 2px' : '14px 16px 12px',
          borderRadius: 16,
          background: plain === true ? 'transparent' : 'var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-2))',
          color: 'var(--dsw-alias-label-primary)',
          fontSize: 13.5,
          lineHeight: '21px',
          boxSizing: 'border-box',
          // 把布局/绘制的重排限制在卡片内部，减少滚动区和消息区的连带重排
          contain: 'layout paint',
          // 入场动画：明显一点（28px 上滑 + 淡入，0.5s）
          animation: 'qmCardIn .5s cubic-bezier(.2,.8,.2,1) both',
          // 宽度跟输入框那张卡一致，并在 dock 里居中（dock 比输入框宽）
          ...(box === null
            ? { width: '100%' }
            : { width: box.width, marginLeft: 'auto', marginRight: 'auto' }),
        },
      },
      // 标题行：小标题 ·（flex 空白）· 下一题(多题) · 跳过 · 页码 · 折叠
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('span', {
          style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
        }, current.header ?? t('float.header')),
        // 页码 + 翻页：紧贴标题右侧（回到你指定的位置）
        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 14.5, fontWeight: 500, color: 'var(--dsw-alias-label-secondary)', flex: 'none' } },
          pagerButton('‹', false, () => setIndex(Math.max(0, safeIndex - 1)), t('float.prev')),
          `${safeIndex + 1}/${questions.length}`,
          pagerButton('›', false, () => setIndex(Math.min(questions.length - 1, safeIndex + 1)), t('float.next')),
        ),
        h('div', { style: { flex: 1 } }),
        // 「下一题」（多题卡才有）：右上角、折叠键左边，答完才亮
        safeIndex < questions.length - 1
          ? h('button', {
              type: 'button',
              onClick: () => {
                if (answered(draft)) setIndex(safeIndex + 1)
              },
              disabled: !answered(draft),
              style: {
                border: '1px solid var(--dsw-alias-border-l2)',
                background: 'transparent',
                color: 'var(--dsw-alias-label-primary)',
                borderRadius: 8,
                height: 28,
                padding: '0 14px',
                font: 'inherit',
                fontSize: 12.5,
                cursor: answered(draft) ? 'pointer' : 'default',
                opacity: answered(draft) ? 1 : 0.5,
                outline: 'none',
                flex: 'none',
              },
            }, t('float.nextQuestion'))
          : null,
        // 「跳过」：右上角，折叠键左边
        h('button', {
          type: 'button',
          onClick: skip,
          style: {
            border: '1px solid var(--dsw-alias-border-l2)',
            background: 'transparent',
            color: 'var(--dsw-alias-label-secondary)',
            borderRadius: 8,
            height: 28,
            padding: '0 10px',
            font: 'inherit',
            fontSize: 12.5,
            cursor: 'pointer',
            outline: 'none',
            flex: 'none',
          },
        }, t('float.skip')),
        // 折叠 / 展开（右上角最右）
        h('button', {
          type: 'button',
          'aria-label': collapsed ? t('float.expand') : t('float.collapse'),
          title: collapsed ? t('float.expand') : t('float.collapse'),
          onClick: () => setCollapsed((value) => !value),
          onMouseDown: (event) => event.preventDefault(),
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            padding: 0,
            border: 'none',
            borderRadius: 8,
            background: 'transparent',
            color: 'var(--dsw-alias-label-secondary)',
            cursor: 'pointer',
            outline: 'none',
            flex: 'none',
            transition: 'background .12s ease, color .12s ease',
          },
        }, h('svg', {
          viewBox: '0 0 16 16',
          width: 16,
          height: 16,
          'aria-hidden': true,
        }, h('path', {
          // 调换过来（用户要的方向）：收起时 ∧，展开时 ∨
          d: collapsed ? 'M3.5 9.5 8 5l4.5 4.5' : 'M3.5 6.5 8 11l4.5-4.5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }))),
      ),
      // 内容区：折叠用实测像素高度做过渡（0 → 实际高度），比长 max-height 过渡顺得多
      h('div', {
        ref: bodyRef,
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          overflow: 'hidden',
          maxHeight: collapsed ? 0 : (bodyHeight > 0 ? bodyHeight : 900),
          opacity: collapsed ? 0 : 1,
          transition: 'max-height .26s cubic-bezier(.2,.8,.2,1), opacity .18s ease',
        },
      },
      // 问题
      h('div', { style: { fontSize: 14.5, fontWeight: 500 } }, current.question),
      // 提问方附带的正文（原生卡也会显示；不显示就丢信息）
      typeof current.detail === 'string' && current.detail.trim() !== ''
        ? h('div', {
            style: {
              fontSize: 12.5,
              lineHeight: '19px',
              color: 'var(--dsw-alias-label-secondary)',
              whiteSpace: 'pre-wrap',
              maxHeight: 180,
              overflow: 'auto',
            },
          }, current.detail)
        : null,
      // 选项
      options.length === 0
        ? null
        : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            options.map((option, optionIndex) =>
              h('button', {
                key: option.label,
                type: 'button',
                onClick: () => choose(option.label),
                style: {
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: `1px solid ${draft.selected.includes(option.label) ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l2)'}`,
                  background: draft.selected.includes(option.label)
                    ? 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent)'
                    : 'transparent',
                  color: 'inherit',
                  font: 'inherit',
                  cursor: 'pointer',
                  outline: 'none',
                },
              },
              h('span', {
                style: {
                  flex: 'none',
                  width: 18,
                  height: 18,
                  marginTop: 1,
                  borderRadius: 5,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 600,
                  background: draft.selected.includes(option.label)
                    ? 'var(--dsw-alias-state-business-primary)'
                    : 'color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent)',
                  color: draft.selected.includes(option.label) ? '#fff' : 'var(--dsw-alias-label-secondary)',
                },
              }, draft.selected.includes(option.label) ? '✓' : String(optionIndex + 1)),
              h('span', { style: { minWidth: 0 } },
                h('span', null, option.label),
                option.description === undefined
                  ? null
                  : h('span', { style: { display: 'block', color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } }, option.description)),
              )),
          ),
      ),
      ),
      // 原生那颗键此刻是「停止」时，盖一个圆形提交键上去（圆是 SVG 画的，不受主题圆角影响）
      sendRect === null || sendRect.visible !== true
        ? null
        : portal(
            h(
              'button',
              {
                type: 'button',
                'aria-label': t('float.submit'),
                title: t('float.submit'),
                'data-question-mode-send': '',
                onMouseDown: (event) => event.preventDefault(),
                onClick: (event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  submitRef.current?.()
                },
                style: {
                  position: 'fixed',
                  left: sendRect.cx - 17,
                  top: sendRect.cy - 17,
                  width: 34,
                  height: 34,
                  margin: 0,
                  padding: 0,
                  border: 'none',
                  background: 'transparent',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  zIndex: 2147482001,
                  lineHeight: 0,
                },
              },
              h(
                'svg',
                { viewBox: '0 0 34 34', width: 34, height: 34, 'aria-hidden': true },
                h('circle', {
                  cx: 17,
                  cy: 17,
                  r: 17,
                  fill: 'var(--dsw-alias-state-business-primary)',
                }),
                // 原生那颗的箭头（16 单位原路径），整体等比放大 1.12 —— 只放大，不拉长
                h(
                  'g',
                  { transform: 'translate(8.05 8.05) scale(1.12)' },
                  h('path', {
                    d: 'M8 2.2v11.2M8 2.2 3.4 6.8M8 2.2l4.6 4.6',
                    fill: 'none',
                    stroke: '#ffffff',
                    strokeWidth: 1.9,
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                  }),
                ),
              ),
            ),
          ),
      )
    }

    /** 设置项右侧那个大开关（不带文字，44×26 轨道 + 20px 圆点）。 */
    function BigSwitch(props) {
      const on = props.on === true
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': on,
          'aria-label': props.label,
          title: props.label,
          onClick: props.onToggle,
          onMouseDown: (event) => event.preventDefault(),
          style: {
            position: 'relative',
            flex: 'none',
            width: 46,
            height: 26,
            padding: 0,
            border: 'none',
            borderRadius: 999,
            outline: 'none',
            cursor: 'pointer',
            background: on
              ? 'var(--dsw-alias-state-business-primary)'
              : 'color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent)',
            transition: 'background .16s ease',
          },
        },
        h('span', {
          style: {
            position: 'absolute',
            top: 3,
            left: on ? 23 : 3,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: '#ffffff',
            boxShadow: '0 1px 3px rgba(0, 0, 0, .38)',
            transition: 'left .16s ease',
          },
        }),
      )
    }

    /** 设置页里的一行：标题 + 说明 + 右侧开关。 */
    function SettingRow(props) {
      const hasExtra = props.extra !== undefined && props.extra !== null
      const [open, setOpen] = React.useState(false)
      // 开关关掉时自动收起它展开的额外设置
      React.useEffect(() => {
        if (props.on !== true) setOpen(false)
      }, [props.on])

      return h(
        'div',
        {
          style: {
            padding: '12px 14px',
            border: '1px solid var(--dsw-alias-border-l2)',
            borderRadius: 12,
            background: 'var(--dsw-alias-bg-layer-1)',
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 16 } },
          h(
            'div',
            { style: { flex: 1, minWidth: 0 } },
            h('div', { style: { fontSize: 14, fontWeight: 500, marginBottom: 4 } }, props.title),
            h(
              'div',
              { style: { fontSize: 12.5, lineHeight: '19px', color: 'var(--dsw-alias-label-secondary)' } },
              props.desc,
            ),
          ),
          // 有额外设置时，开关往左让一点，右边留出展开键的位置
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flex: 'none', marginRight: hasExtra ? 2 : 0 } },
            h(BigSwitch, { label: props.title, on: props.on, onToggle: props.onToggle }),
            hasExtra
              ? h(
                  'button',
                  {
                    type: 'button',
                    'aria-label': open ? '收起' : '展开',
                    title: open ? '收起' : '展开',
                    onClick: () => setOpen((value) => !value),
                    style: {
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 26,
                      height: 26,
                      padding: 0,
                      border: 'none',
                      borderRadius: 8,
                      background: 'transparent',
                      color: 'var(--dsw-alias-label-secondary)',
                      cursor: 'pointer',
                      outline: 'none',
                    },
                  },
                  h(
                    'svg',
                    { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true },
                    h('path', {
                      d: open ? 'M3.5 9.5 8 5l4.5 4.5' : 'M3.5 6.5 8 11l4.5-4.5',
                      fill: 'none',
                      stroke: 'currentColor',
                      strokeWidth: 1.7,
                      strokeLinecap: 'round',
                      strokeLinejoin: 'round',
                    }),
                  ),
                )
              : null,
          ),
        ),
        hasExtra && open
          ? h(
              'div',
              {
                style: {
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: '1px solid var(--dsw-alias-border-l2)',
                },
              },
              props.extra,
            )
          : null,
      )
    }

    /** 插件设置页：提问模式开关 + 提问窗口优化。 */
    function FloatModeSetting(props) {
      const t = props.t === undefined ? (key) => key : props.t
      const [ask, setAsk] = React.useState(null)
      const [optimized, setOptimized] = React.useState(null)
      const [autoNextOn, setAutoNextOn] = React.useState(autoNext)
      const [confirmFirstOn, setConfirmFirstOn] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => {
        let alive = true
        const pull = () => {
          readAskMode()
            .then((value) => {
              if (!alive || value === null || value === undefined) return
              if (value.ok) {
                setAsk(value.active === true)
                setOptimized(value.optimized !== false)
                setConfirmFirstOn(value.confirmFirst !== false)
              }
            })
            .catch(() => {
              if (alive) setAsk(false)
            })
        }
        pull()
        const sync = () => {
          if (document.visibilityState !== 'visible') return
          pull()
        }
        document.addEventListener('visibilitychange', sync)
        window.addEventListener('focus', sync)
        return () => {
          alive = false
          document.removeEventListener('visibilitychange', sync)
          window.removeEventListener('focus', sync)
        }
      }, [])

      const toggleAsk = () => {
        if (busy) return
        const next = ask !== true
        setBusy(true)
        setAsk(next)
        writeAskMode(next)
          .then((value) => {
            if (value && value.ok) setAsk(value.active === true)
            else setAsk(!next)
          })
          .catch(() => setAsk(!next))
          .finally(() => setBusy(false))
      }

      const toggleConfirmFirst = () => {
        if (busy) return
        const next = confirmFirstOn !== true
        setBusy(true)
        setConfirmFirstOn(next)
        writeConfirm(next)
          .then((value) => {
            if (value && value.ok) setConfirmFirstOn(value.confirmFirst !== false)
            else setConfirmFirstOn(!next)
          })
          .catch(() => setConfirmFirstOn(!next))
          .finally(() => setBusy(false))
      }

      const toggleAutoNext = () => {
        const next = autoNextOn !== true
        setAutoNextOn(next)
        rememberAutoNext(next)
      }

      const toggleOptimized = () => {
        if (busy) return
        const next = optimized !== true
        setBusy(true)
        setOptimized(next)
        writeOptimized(next)
          .then((value) => {
            if (value && value.ok) setOptimized(value.optimized !== false)
            else setOptimized(!next)
          })
          .catch(() => setOptimized(!next))
          .finally(() => setBusy(false))
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 10, margin: '12px 0' } },
        // 插件自己的抬头：名字 + 英文名
        h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 } },
          h('div', { style: { fontSize: 15, fontWeight: 600 } }, t('setting.brand')),
          h(
            'div',
            { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
            t('setting.brand.sub'),
          ),
        ),
        h(SettingRow, {
          title: t('setting.ask.title'),
          desc: t('setting.ask.desc'),
          on: ask === true,
          onToggle: toggleAsk,
          extra: h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 16 } },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: 13.5, fontWeight: 500 } }, t('setting.confirm.title')),
            ),
            h(BigSwitch, {
              label: t('setting.confirm.title'),
              on: confirmFirstOn === true,
              onToggle: toggleConfirmFirst,
            }),
          ),
        }),
        h(SettingRow, {
          title: t('setting.opt.title'),
          desc: t('setting.opt.desc'),
          on: optimized === true,
          onToggle: toggleOptimized,
          extra: h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 16 } },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: 13.5, fontWeight: 500 } }, t('setting.autoNext.title')),
            ),
            h(BigSwitch, {
              label: t('setting.autoNext.title'),
              on: autoNextOn === true,
              onToggle: toggleAutoNext,
            }),
          ),
        }),
      )
    }

    // ────────────────────────────────────────────────────────────────
    // 草稿附件：原生是一排缩略图，这里换成「图1/图2…」的超薄边框按钮。
    //   · 悬停按钮 → 右侧弹「删除」，上方弹缩略图（浮动，不顶布局）
    //   · 点到删除按钮上时，父容器仍然是 hover 状态，所以不会闪断
    //   · 点按钮 → 全屏大图预览（Esc / 点空白关闭）
    //   · 拖拽仍然交给 onAddFiles，行为和原生一致
    // ────────────────────────────────────────────────────────────────
    function DraftAttachmentBar(props) {
      const attachments = Array.isArray(props.attachments) ? props.attachments : []
      draftAttachments = attachments
      const t = props.t === undefined ? (key) => key : props.t
      const [hover, setHover] = React.useState(null)
      const [zoom, setZoom] = React.useState(null)
      const [rect, setRect] = React.useState(null)
      const rootRef = React.useRef(null)

      // 拖拽入草稿（原生行为：整窗可拖）
      React.useEffect(() => {
        if (props.canAcceptDrop !== true) return undefined
        let depth = 0
        const over = (event) => {
          event.preventDefault()
          if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
        }
        const enter = (event) => {
          depth += 1
          over(event)
        }
        const leave = () => {
          depth = Math.max(0, depth - 1)
        }
        const drop = (event) => {
          event.preventDefault()
          depth = 0
          const files = Array.from(event.dataTransfer?.files ?? [])
          if (files.length > 0 && props.canAcceptDrop === true) props.onAddFiles(files)
        }
        document.addEventListener('dragover', over)
        document.addEventListener('dragenter', enter)
        document.addEventListener('dragleave', leave)
        document.addEventListener('drop', drop)
        return () => {
          document.removeEventListener('dragover', over)
          document.removeEventListener('dragenter', enter)
          document.removeEventListener('dragleave', leave)
          document.removeEventListener('drop', drop)
        }
      }, [props.canAcceptDrop, props.onAddFiles])

      React.useEffect(() => {
        if (zoom === null) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') setZoom(null)
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [zoom])

      if (attachments.length === 0) return null

      const hovered = attachments.find((item) => item.id === hover)
      const label = (item) => {
        const index = attachments.findIndex((entry) => entry.id === item.id)
        if (item.kind === 'file') {
          const name = item.file?.name ?? ''
          return name === '' ? t('attach.file') : name.length > 14 ? `${name.slice(0, 13)}…` : name
        }
        return t('attach.image', { n: index + 1 })
      }
      /** 悬停提示用真实文件名（按钮上仍然是「图N」）。 */
      const fileName = (item) => {
        const name = item.file?.name
        return typeof name === 'string' && name !== '' ? name : label(item)
      }

      return h(
        'div',
        {
          ref: rootRef,
          'data-question-mode-attachments': '',
          style: {
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            // 跟下面那排小控件（+ / 权限 / 提问模式）的左边缘对齐
            padding: '4px 0 6px 15px',
          },
        },
        attachments.map((item) =>
          h(
            'span',
            {
              key: item.id,
              style: { display: 'inline-flex', alignItems: 'center', gap: 6 },
              onMouseEnter: (event) => {
                setHover(item.id)
                // 量的是按钮本身（不是整行/对话框），浮层按它定位
                const button = event.currentTarget.firstElementChild
                const box = (button ?? event.currentTarget).getBoundingClientRect()
                setRect({ left: box.left, top: box.top, width: box.width })
              },
              onMouseLeave: () => setHover(null),
            },
            h(
              'button',
              {
                type: 'button',
                title: fileName(item),
                'aria-label': fileName(item),
                onClick: () => {
                  if (item.kind === 'image' && typeof item.previewUrl === 'string') setZoom(item)
                },
                style: {
                  boxSizing: 'border-box',
                  display: 'inline-flex',
                  alignItems: 'center',
                  height: 26,
                  maxWidth: 170,
                  padding: '0 10px',
                  border: '1px solid var(--dsw-alias-border-l2)',
                  borderRadius: 7,
                  background:
                    hover === item.id
                      ? 'color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent)'
                      : 'transparent',
                  color: 'var(--dsw-alias-label-secondary)',
                  font: 'inherit',
                  fontSize: 12.5,
                  lineHeight: '18px',
                  cursor: 'pointer',
                  outline: 'none',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  transition: 'background .12s ease, color .12s ease',
                },
              },
              label(item),
            ),
            // 「删除」：参与布局（不绝对定位）→ 悬停时把后面的按钮推开，不会互相遮挡
            hover === item.id
              ? h(
                  'button',
                  {
                    type: 'button',
                    title: t('attach.remove'),
                    'aria-label': t('attach.remove'),
                    onClick: (event) => {
                      event.stopPropagation()
                      props.onRemoveAttachment?.(item.id)
                    },
                    style: {
                      boxSizing: 'border-box',
                      height: 26,
                      padding: '0 9px',
                      border: '1px solid var(--dsw-alias-border-l2)',
                      borderRadius: 7,
                      background: 'var(--dsw-alias-bg-layer-2)',
                      color: 'var(--dsw-alias-state-error-primary)',
                      font: 'inherit',
                      fontSize: 12.5,
                      lineHeight: '18px',
                      cursor: 'pointer',
                      outline: 'none',
                      whiteSpace: 'nowrap',
                    },
                  },
                  t('attach.remove'),
                )
              : null,
            // 上方缩略图：portal 到 body + 按按钮的 rect 定位（不参与布局）
            hover === item.id && rect !== null && item.kind === 'image' && typeof item.previewUrl === 'string'
              ? portal(
                  h(
                    'div',
                    {
                      style: {
                        position: 'fixed',
                        // 定宽 + 手算居中：不依赖百分比 transform，横向绝对不会偏
                        width: 200,
                        left: Math.max(
                          8,
                          Math.min(
                            rect.left + rect.width / 2 - 100,
                            window.innerWidth - 208,
                          ),
                        ),
                        top: Math.max(8, rect.top - 8),
                        transform: 'translateY(-100%)',
                        zIndex: 2147483000,
                        padding: 4,
                        borderRadius: 10,
                        background: 'var(--dsw-alias-bg-overlay)',
                        border: '1px solid var(--dsw-alias-border-l2)',
                        boxShadow: '0 12px 32px rgba(0, 0, 0, .5)',
                        pointerEvents: 'none',
                      },
                    },
                    h('img', {
                      src: item.previewUrl,
                      alt: '',
                      style: { display: 'block', width: '100%', maxHeight: 150, objectFit: 'contain', borderRadius: 6 },
                    }),
                  ),
                )
              : null,
          ),
        ),
        zoom === null
          ? null
          : portal(
              h('div', {
                onClick: () => setZoom(null),
                style: {
                  position: 'fixed',
                  inset: 0,
                  zIndex: 90,
                  background: 'rgba(0, 0, 0, .72)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 32,
                  cursor: 'zoom-out',
                },
              }, h('img', {
                src: zoom.previewUrl,
                alt: '',
                style: {
                  maxWidth: '100%',
                  maxHeight: '100%',
                  borderRadius: 8,
                  boxShadow: '0 12px 40px rgba(0, 0, 0, .5)',
                },
              })),
            ),
      )
    }

    // 自测接缝：render-check.mjs 直接拿这两个组件跑离线渲染
    try {
      globalThis.__dshQuestionModeTest__ = { AskCard, QuestionDock }
    } catch {
      /* 无 globalThis 的环境就算了 */
    }

    return {
      inject: ['slots', 'locale', 'remote'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'question-mode: 词条')

        // 浮层问答 · 实现方式：
        // 原生提问卡占 `conversation.composer` 链座位，渲染器把 fallback（含原生输入框）
        // 写成 `display:none`。接管 `user-questions/request` 这条路被事件顺序卡住了（原生先注册），
        // 所以改用两条覆盖规则，纯 CSS、可随时摘掉：
        //   a) `[data-chain-overlay-fallback="conversation.composer"]`
        //      → display:contents !important（把被藏起来的原生输入框放回来）
        //   b) 它的下一个兄弟节点 = 被选中的提问卡
        //      → position:fixed 浮到输入框上方 + 向上弹出的动画

        ctx.effect(
          () => {
            const style = document.createElement('style')
            style.dataset.plugin = 'dsh-question-mode'
            style.dataset.pluginCss = 'question-mode/anim'
            style.textContent =
              '@keyframes qmCardIn{from{opacity:0;transform:translateY(28px)}60%{opacity:1}to{opacity:1;transform:translateY(0)}}'
            document.head.appendChild(style)
            return () => style.remove()
          },
          'question-mode: qmCardIn keyframes',
        )

        // 提问面板：挂在输入框正上方的 dock 座位上 —— 它**参与布局**，
        // 所以卡片出现时消息区会整体上移，不会像 fixed 浮层那样遮住对话；
        // 同时它不占 `conversation.composer` 链座位，原生输入框原样保留。
        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.dock',
              id: 'question-mode-ask',
              order: 40,
              locale: NS,
            },
            QuestionDock,
          ),
        )
        // 提问模式开关不再放在输入框下面，统一挪到插件设置页里
        // 插件设置页里那一项：单独控制提问界面的样式（浮层 / 原生卡片）
        ctx.slots.inject('plugins.bundle.config', () =>
          ctx.slots.register(
            {
              name: 'plugins.bundle.config',
              key: 'dsh-question-mode',
              locale: NS,
            },
            FloatModeSetting,
          ),
        )
        // 草稿附件栏：替换原生的缩略图一排。
        // ⚠ single 座位按 priority 升序取第一个（entriesOfSlot 只去重 key/id，single 没有 id），
        //    所以必须用比原生更小的 priority 才能排到它前面；组件一旦抛错会被 abdicate，自动退回原生。
        ctx.slots.inject('conversation.input.attachments', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.attachments',
              priority: -1,
              locale: NS,
            },
            DraftAttachmentBar,
          ),
        )
      },
    }
  },
})
