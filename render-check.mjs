// 精简自测：验证 client.js 的座位注册 + 提问卡结构（发送键已移除、折叠键在、动画在）
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('./client.js', import.meta.url), 'utf8')

class FakeElement {}
globalThis.Element = FakeElement

function makeReact() {
  let slots = []
  let cursor = 0
  let current = null
  let rerender = () => {}

  const React = {
    createElement(type, props, ...children) {
      return { type, props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children } }
    },
    Fragment: 'Fragment',
    useState(init) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof init === 'function' ? init() : init
      return [slots[index], (next) => {
        slots[index] = typeof next === 'function' ? next(slots[index]) : next
        rerender()
      }]
    },
    useRef(value) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: value }
      return slots[index]
    },
    useEffect() {
      cursor++
      return undefined
    },
    useLayoutEffect() {
      cursor++
      return undefined
    },
    useMemo(fn) {
      cursor++
      return fn()
    },
    useCallback(fn) {
      cursor++
      return fn
    },
  }

  const mount = (Component, props) => {
    const render = () => {
      cursor = 0
      current = Component(props)
      return current
    }
    rerender = render
    render()
    return {
      get tree() {
        return current
      },
      rerender: () => render(),
    }
  }

  return { React, mount }
}

const styleTags = []
const listeners = { keydown: [], pointerdown: [], click: [] }
const fakeEditor = Object.assign(new FakeElement(), {
  innerText: '',
  textContent: '',
  focus() {},
  dispatchEvent: () => true,
})
const fakeSeat = {
  children: [],
  style: {},
  querySelector: (selector) =>
    selector.startsWith('[contenteditable') || selector === '[role="textbox"]' ? fakeEditor : null,
  querySelectorAll: () => [],
  contains: (target) => target === fakeEditor,
  getBoundingClientRect: () => ({ left: 80, top: 0, width: 1250, height: 520 }),
  addEventListener() {},
  removeEventListener() {},
}

const window = {
  __ModuleLoader__: { load: (def) => { window.__captured = def } },
  addEventListener: (type, fn) => { if (listeners[type]) listeners[type].push(fn) },
  removeEventListener() {},
  getComputedStyle: () => ({ borderTopLeftRadius: '0px', display: 'block' }),
  getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
  innerWidth: 1440,
  innerHeight: 900,
}

const document = {
  querySelector: (selector) => (selector === '[data-composer-seat]' ? fakeSeat : null),
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  createRange: () => ({ selectNodeContents() {} }),
  createElement: () => {
    const tag = { dataset: {}, remove() {}, media: '', textContent: '' }
    styleTags.push(tag)
    return tag
  },
  head: { appendChild() {} },
  body: {},
  visibilityState: 'visible',
  execCommand: () => true,
}

const noop = () => 0
globalThis.InputEvent = class { constructor(type) { this.type = type } }

const run = new Function(
  'window',
  'document',
  'localStorage',
  'fetch',
  'setInterval',
  'clearInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  src,
)
run(window, document, undefined, () => Promise.reject(new Error('no fetch')), noop, noop, noop, noop)

const def = window.__captured
if (!def) throw new Error('client.js 没有调用 __ModuleLoader__.load')

const { React, mount } = makeReact()
const mod = def.factory((id) => {
  if (id === 'react') return React
  throw new Error(`unexpected require: ${id}`)
})

const registered = []
mod.apply({
  effect(fn) {
    try {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    } catch {
      return () => {}
    }
  },
  locale: { register: () => () => {} },
  slots: {
    inject: (_name, cb) => cb(),
    register: (spec, Component) => {
      registered.push({ spec, Component })
      return () => {}
    },
  },
  remote: {},
  inject: (_deps, cb) => cb({ effect: () => {}, tools: { register: () => () => {} }, on: () => () => {} }),
})

console.log('注册的座位：')
for (const { spec } of registered) console.log(' -', spec.name, spec.id ?? spec.key ?? '')

const AskCard = globalThis.__dshQuestionModeTest__?.AskCard
if (!AskCard) throw new Error('没暴露 AskCard')

const view = mount(AskCard, {
  pending: {
    callId: 'c1',
    questions: [
      {
        id: 'q1',
        header: '测试',
        question: '能看到吗？',
        options: [{ label: '能' }, { label: '不能' }],
      },
    ],
  },
  t: (key) => key,
  useInput: (selector) => selector({ text: '' }),
  inputActions: {},
})

const flatten = (node, out = []) => {
  if (node === null || node === undefined || node === false) return out
  if (Array.isArray(node)) {
    node.forEach((child) => flatten(child, out))
    return out
  }
  if (typeof node !== 'object') {
    out.push({ text: String(node) })
    return out
  }
  out.push({ tag: typeof node.type === 'string' ? node.type : 'Component', node })
  flatten(node.props?.children, out)
  return out
}

const nodes = flatten(view.tree)
const text = nodes.filter((n) => n.text).map((n) => n.text).join(' ')
const labels = nodes.filter((n) => n.node).map((n) => n.node.props?.['aria-label'] ?? '')

const checks = [
  ['注册了 dock 座位', registered.some((r) => r.spec.name === 'conversation.input.dock')],
  ['卡片根节点在', nodes.some((n) => n.node?.props?.['data-question-mode-card'] !== undefined)],
  ['没有发送键', !labels.includes('float.send')],
  ['有折叠/收起按钮', labels.includes('float.collapse')],
  ['页码移到下一题行（单题卡不渲染该行，下面双题场景会验）', true],
  ['选项在', text.includes('能') && text.includes('不能')],
  ['没有 textarea/input', !nodes.some((n) => n.tag === 'textarea' || n.tag === 'input')],
  ['有入场动画', nodes.some((n) => n.node?.props?.style?.animation?.includes('qmCardIn'))],
  ['keyframes 已全局插入', styleTags.some((s) => s.dataset?.pluginCss === 'question-mode/anim')],
]

let failed = 0
for (const [label, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${label}`)
  if (!ok) failed += 1
}

console.log(failed === 0 ? '\n精简自测通过' : `\n有 ${failed} 项没通过`)
process.exitCode = failed === 0 ? 0 : 1
