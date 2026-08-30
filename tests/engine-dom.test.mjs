/**
 * engine.js DOM 行为回归测试(node:test + 伪 DOM 垫片,零依赖)
 *
 * 运行:node --test tests/engine-dom.test.mjs
 *
 * 背景:v1.3.3 性能事故——ScriptCat 在 document-start 注入时,站点水合渲染
 * 产生大量脱离文档的临时文本节点,旧引擎对每个孤立节点都退化为
 * "全页 × 全部选择器"扫描,主线程被吃满。本地 CDP 注入测试没有暴露
 * (注入时页面已渲染完)。本文件把这次事故的每个防护点固化成断言:
 *   1. 孤立文本节点必须被忽略(绝不退化为全页扫描)
 *   2. 引擎自写回写不再进入重扫(characterData/attributes 两条路)
 *   3. 别人改的文本/属性仍会被重新翻译
 *   4. 变更洪水(一次数百 addedNodes)被合并,扫描总量有界
 *
 * 垫片只实现引擎实际用到的 API 面(已用 grep 盘点):
 * document.body/readyState/documentElement/addEventListener,
 * Node.TEXT_NODE/ELEMENT_NODE, MutationObserver, requestIdleCallback,
 * setTimeout, location.reload;元素级 matches/querySelectorAll 只支持
 * 词库测试里用到的简单标签选择器与 [placeholder]/[aria-label]。
 * 伪 DOM 教训(沿用 openrouter 项目):属性名必须与真实 DOM 一致(parentNode 等)。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- 伪 DOM ---------- */

// querySelectorAll 调用计数:性能防护的本质是"扫描总量有界",
// 断言扫描次数而非仅写入次数,才能区分"正确"与"正确且不浪费"。
// loadEngine() 会将其归零并返回读取器。
const scanCounter = { n: 0 };

class MiniNode {
    constructor() { this.childNodes = []; this.parentNode = null; }
    // 真实 DOM 的 Text 节点同时有 parentNode 和 parentElement,缺一个引擎就会漏判
    get parentElement() { return this.parentNode; }
    appendChild(c) { c.parentNode = this; this.childNodes.push(c); return c; }
    remove() {
        if (this.parentNode) {
            const i = this.parentNode.childNodes.indexOf(this);
            if (i >= 0) this.parentNode.childNodes.splice(i, 1);
            this.parentNode = null;
        }
    }
}

class MiniText extends MiniNode {
    constructor(value) { super(); this.nodeType = 3; this._value = value; this.writes = 0; }
    get nodeValue() { return this._value; }
    set nodeValue(v) { this.writes++; this._value = v; }
}

const SIMPLE = /^[a-z]+$/;

function matchSimple(el, css) {
    return css.split(',').some((part) => {
        part = part.trim();
        if (!part) return false;
        let rest = part, tagOk = true;
        const tagMatch = part.match(/^([a-z]+)((?:\[[^\]]+\])+)$/);
        if (tagMatch) { rest = part.slice(tagMatch[1].length); }
        else if (/^[a-z]+$/.test(part)) { rest = ''; tagOk = el.tagName === part.toUpperCase(); }
        // 剩余部分全是 [attr] 要求
        const attrRe = /\[([a-zA-Z-]+)\]/g;
        let m;
        while ((m = attrRe.exec(rest)) !== null) {
            if (el.getAttribute(m[1]) === null) return false;
        }
        if (rest && !attrRe.test(rest) && tagMatch === null) return false;
        return tagOk;
    });
}

class MiniElement extends MiniNode {
    constructor(tag) {
        super();
        this.nodeType = 1;
        this.tagName = tag.toUpperCase();
        this.attrs = new Map();
        this.attrWrites = new Map();
    }
    getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
    setAttribute(n, v) { this.attrWrites.set(n, (this.attrWrites.get(n) || 0) + 1); this.attrs.set(n, v); }
    removeAttribute(n) { this.attrs.delete(n); }
    matches(css) { return matchSimple(this, css); }
    querySelectorAll(css) {
        scanCounter.n++;
        const out = [];
        const walk = (el) => { for (const c of el.childNodes) { if (c.nodeType === 1) { if (matchSimple(c, css)) out.push(c); walk(c); } } };
        walk(this);
        return out;
    }
}

/* ---------- 引擎装载(小词库,选择器只含垫片支持的简单标签) ---------- */

function loadEngine() {
    scanCounter.n = 0;
    const body = new MiniElement('body');
    const html = new MiniElement('html');
    const observers = [];
    const idleQueue = [];

    const documentShim = {
        readyState: 'complete',
        body,
        documentElement: html,
        title: '',
        addEventListener() {},
    };
    const sandbox = {
        document: documentShim,
        location: { reload() {} },
        Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
        MutationObserver: class { constructor(cb) { observers.push(cb); } observe() {} disconnect() {} },
        requestIdleCallback: (fn) => { idleQueue.push(fn); return idleQueue.length; },
        setTimeout: (fn) => { idleQueue.push(fn); return idleQueue.length; },
        clearTimeout() {},
        console,
    };
    sandbox.window = sandbox;

    const strip = (s) => s.replace(/^export\s+/gm, '');
    const core = strip(readFileSync(join(root, 'i18n-core.mjs'), 'utf8'));
    const engine = readFileSync(join(root, 'engine.js'), 'utf8');
    const dict = {
        DOC: {}, STATIC: { span: { Models: '模型', Datasets: '数据集' } },
        INPUT: { 'Type here': '输入' }, LABEL: { Search: '搜索' }, DYNAMIC: {}, REGEX: [],
    };
    const code = `(function(){'use strict';\n${core}\n` +
        `const __LOCALES = ${JSON.stringify(dict)};\n` +
        `const __DICT_VERSION = 'test'; const __ENTRY_COUNT = 4; const __VERSION = 'test';\n` +
        engine + '\n})();';
    vm.runInNewContext(code, sandbox);

    return {
        body,
        document: documentShim,
        scans: () => scanCounter.n,
        /** 手动投递突变记录(等价于真实 MutationObserver 的微任务批)。
         * 真实记录恒带 addedNodes/removedNodes 数组,垫片补齐以保证保真度 */
        deliver(records) {
            const normalized = records.map((r) => ({ addedNodes: [], removedNodes: [], ...r }));
            for (const cb of observers) cb(normalized, {});
        },
        /** 执行排队的空闲批处理 */
        flushIdle() { for (const fn of idleQueue.splice(0)) fn(); },
    };
}

function makeSpanWithText(doc, text) {
    const span = new MiniElement('span');
    const t = new MiniText(text);
    span.appendChild(t);
    doc.body.appendChild(span);
    return { span, t };
}

/* ---------- 回归断言 ---------- */

describe('engine 性能防护(v1.3.3 事故回归)', () => {
    test('孤立文本节点被忽略,绝不退化为全页扫描', () => {
        const h = loadEngine();
        h.flushIdle(); // 先排空引擎启动时的初始全页扫描
        const { span } = makeSpanWithText(h.document, 'Models');
        const detached = new MiniText('Datasets'); // 无 parentNode
        h.deliver([{ type: 'childList', target: h.document.body, addedNodes: [detached] }]);
        h.flushIdle();
        assert.strictEqual(detached.parentNode, null);
        // 旧引擎会 fallback 到 document.body 从而顺带翻译 span;修复后不得发生
        assert.strictEqual(span.childNodes[0].nodeValue, 'Models');
    });

    test('正常新增的文本节点会被翻译', () => {
        const h = loadEngine();
        const { t } = makeSpanWithText(h.document, 'Models');
        h.deliver([{ type: 'childList', target: h.document.body, addedNodes: [t.parentNode] }]);
        h.flushIdle();
        assert.strictEqual(t.nodeValue, '模型');
        assert.strictEqual(t.writes, 1);
    });

    test('引擎自写回写不触发重扫(characterData 守卫)', () => {
        const h = loadEngine();
        const { t } = makeSpanWithText(h.document, 'Models');
        h.deliver([{ type: 'childList', target: h.document.body, addedNodes: [t.parentNode] }]);
        h.flushIdle();
        assert.strictEqual(t.nodeValue, '模型');
        const baseline = h.scans();
        // 投递"引擎自己那次写入"产生的 characterData 突变:
        // 旧引擎会重扫父元素(无谓开销),新引擎必须零扫描
        h.deliver([{ type: 'characterData', target: t }]);
        h.flushIdle();
        assert.strictEqual(t.nodeValue, '模型');
        assert.strictEqual(t.writes, 1, '自写回写不得引起二次写入');
        assert.strictEqual(h.scans(), baseline, '自写回写不得引起任何重扫');
    });

    test('别人改的文本仍会被重新翻译(防过度守卫)', () => {
        const h = loadEngine();
        const { t } = makeSpanWithText(h.document, 'Models');
        h.deliver([{ type: 'childList', target: h.document.body, addedNodes: [t.parentNode] }]);
        h.flushIdle();
        t._value = 'Datasets'; // 模拟框架就地改文本(绕过 write 计数)
        const baseline = h.scans();
        h.deliver([{ type: 'characterData', target: t }]);
        h.flushIdle();
        assert.strictEqual(t.nodeValue, '数据集');
        assert.ok(h.scans() > baseline, '别人的改动必须触发重查,不能被守卫误吞');
    });

    test('属性自写回写守卫(aria-label/placeholder)', () => {
        const h = loadEngine();
        const el = new MiniElement('input');
        el.setAttribute('placeholder', 'Type here');
        el.setAttribute('aria-label', 'Search');
        h.document.body.appendChild(el);
        h.deliver([{ type: 'childList', target: h.document.body, addedNodes: [el] }]);
        h.flushIdle();
        assert.strictEqual(el.getAttribute('placeholder'), '输入');
        assert.strictEqual(el.getAttribute('aria-label'), '搜索');
        const pw = el.attrWrites.get('placeholder');
        const aw = el.attrWrites.get('aria-label');
        const baseline = h.scans();
        // 投递引擎自写产生的 attributes 突变
        h.deliver([{ type: 'attributes', target: el, attributeName: 'placeholder' }]);
        h.deliver([{ type: 'attributes', target: el, attributeName: 'aria-label' }]);
        h.flushIdle();
        assert.strictEqual(el.attrWrites.get('placeholder'), pw, 'placeholder 自写不得引起二次写入');
        assert.strictEqual(el.attrWrites.get('aria-label'), aw, 'aria-label 自写不得引起二次写入');
        assert.strictEqual(h.scans(), baseline, '属性自写回写不得引起任何重扫');
        // 别人改回英文,应再次翻译
        el.setAttribute('placeholder', 'Type here');
        h.deliver([{ type: 'attributes', target: el, attributeName: 'placeholder' }]);
        h.flushIdle();
        assert.strictEqual(el.getAttribute('placeholder'), '输入');
    });

    test('变更洪水合并:一次数百 addedNodes 扫描有界且全部被翻译', () => {
        const h = loadEngine();
        h.flushIdle(); // 排空初始全页扫描
        const spans = [];
        const added = [];
        for (let i = 0; i < 400; i++) {
            const s = new MiniElement('span');
            s.appendChild(new MiniText(i % 2 ? 'Models' : 'Datasets'));
            h.document.body.appendChild(s);
            spans.push(s);
            added.push(s);
        }
        const baseline = h.scans();
        const t0 = process.hrtime.bigint();
        h.deliver([{ type: 'childList', target: h.document.body, addedNodes: added }]);
        h.flushIdle();
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        for (const [i, s] of spans.entries()) {
            assert.strictEqual(s.childNodes[0].nodeValue, i % 2 ? '模型' : '数据集', `第 ${i} 个未翻译`);
        }
        // 旧引擎逐根扫描 = 400+ 次查询;新引擎合并为单根全页扫描,必须有个位数量级上界
        const delta = h.scans() - baseline;
        assert.ok(delta <= 10, `洪水处理扫描次数无界: ${delta}(旧引擎为每根一次,400+)`);
        assert.ok(ms < 2000, `洪水合并后单轮处理耗时异常: ${ms.toFixed(0)}ms`);
    });
});
