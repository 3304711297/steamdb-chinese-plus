/* ======================================================================
 * 翻译引擎(原创实现)
 *
 * 设计思路参考 Chr_/GM_Scripts SteamDB_CN(AGPL-3.0)的选择器作用域方案,
 * 未复制其引擎代码。改进点:
 *   1. 上游引擎只在页面加载时翻译一次;本引擎用 MutationObserver +
 *      requestIdleCallback 空闲批处理,表格排序/通知面板等动态内容也能翻译
 *   2. 文本替换保留节点原文的前导/尾随空白,不破坏布局
 *   3. DYNAMIC 段在上游标注"暂未实装",本引擎已实装(与 STATIC 同机制)
 *
 * SteamDB 是服务端渲染为主的站点:词库按 CSS 选择器圈定作用域,
 * 词典精确匹配本身就是安全机制,不会误伤应用名/价格等页面数据。
 * ====================================================================== */

// HAS_LETTER / MAX_TEXT_LENGTH 由 i18n-core 提供(同一作用域内联),这里不重复声明

/* 补充词库已由 build 合并进 __LOCALES;这里只做统一结构 */
const STATIC_SCOPES = Object.entries(__LOCALES.STATIC || {});
const DYNAMIC_SCOPES = Object.entries(__LOCALES.DYNAMIC || {});
const INPUT_DICT = __LOCALES.INPUT || {};
const LABEL_DICT = __LOCALES.LABEL || {};
const REGEX_RULES = compileRules(__LOCALES.REGEX || []);

/* ---- 未命中词输出开关(脚本菜单切换,便于给补充词库攒词条) ---- */
function loadOutputToggle() {
    try {
        if (typeof GM_getValue === 'function') return GM_getValue('output_unmatched', false);
    } catch { /* 无存储环境按默认关闭 */ }
    return false;
}
let outputUnmatched = loadOutputToggle();
const unmatchedSeen = new Set();

function registerMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand(
        (outputUnmatched ? '🔴 停止' : '🟢 开始') + '在控制台输出未命中词(攒词条用)',
        () => {
            outputUnmatched = !outputUnmatched;
            try {
                if (typeof GM_setValue === 'function') GM_setValue('output_unmatched', outputUnmatched);
            } catch { /* 忽略存储失败 */ }
            location.reload();
        }
    );
}

function logUnmatched(raw, scope) {
    if (!outputUnmatched) return;
    const key = raw.trim().replace(/\s+/g, ' ');
    if (!key || unmatchedSeen.has(key)) return;
    unmatchedSeen.add(key);
    console.log(`[SteamDB中文] 未命中(${scope}): "${key}"`);
}

/** 翻译单个文本节点;已处理节点记入 WeakSet,不重复查找 */
function applyTranslation(textNode, dict) {
    if (translatedNodes.has(textNode)) return;
    translatedNodes.add(textNode);
    const text = textNode.nodeValue;
    if (!text) return;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_TEXT_LENGTH || !HAS_LETTER.test(trimmed)) return;
    const key = trimmed.replace(/\s+/g, ' ');
    const zh = dict[key] ?? (REGEX_RULES.length ? lookupRegex(REGEX_RULES, key) : null);
    if (!zh) { logUnmatched(key, 'text'); return; }
    // 只替换首个命中段,保留原文的前导/尾随空白;记录回写值供 observer 识别自写
    const next = text.replace(trimmed, zh);
    if (next === text) return;
    lastTextWrite.set(textNode, next);
    textNode.nodeValue = next;
}

/** 翻译元素内的直接文本节点;无子元素时整个元素只有文本,直接处理其文本节点 */
function translateElementTexts(element, dict) {
    for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) applyTranslation(node, dict);
    }
}

/**
 * 在 root 范围内应用一组选择器作用域词典。
 * root 自身命中选择器也要处理(SPA 局部替换时 root 常就是要翻的元素)。
 */
function applyScoped(root, css, dict) {
    let targets = null;
    try {
        targets = root.matches && root.matches(css) ? [root] : [];
        targets.push(...root.querySelectorAll(css));
    } catch (e) {
        // 上游词库选择器手误不应中断整个引擎
        console.warn('[SteamDB中文] 非法选择器,已跳过:', css, e.message);
        return;
    }
    for (const el of targets) translateElementTexts(el, dict);
}

function translateAttributes(root) {
    const inputs = root.matches && root.matches('input[placeholder]')
        ? [root, ...root.querySelectorAll('input[placeholder]')]
        : root.querySelectorAll('input[placeholder]');
    for (const el of inputs) {
        const raw = el.getAttribute('placeholder');
        if (!raw) continue;
        const zh = lookupSimple(INPUT_DICT, raw);
        if (zh === null) { logUnmatched(raw, 'placeholder'); continue; }
        const next = raw.replace(raw.trim(), zh);
        // 自己写回的值不再重复写:没有这一步,任何同引擎/其他翻译扩展的回写
        // 都会经 attributes observer 再次进入这里,极端情况下互相触发成风暴
        if (next === raw) continue;
        lastAttrWrite.set(el, 'placeholder\0' + next);
        el.setAttribute('placeholder', next);
    }
    const labelled = root.matches && root.matches('[aria-label]')
        ? [root, ...root.querySelectorAll('[aria-label]')]
        : root.querySelectorAll('[aria-label]');
    for (const el of labelled) {
        const raw = el.getAttribute('aria-label');
        if (!raw) continue;
        const zh = lookupSimple(LABEL_DICT, raw);
        if (zh === null) { logUnmatched(raw, 'aria-label'); continue; }
        const next = raw.replace(raw.trim(), zh);
        if (next === raw) continue;
        lastAttrWrite.set(el, 'aria-label\0' + next);
        el.setAttribute('aria-label', next);
    }
}

function processRoot(root) {
    for (const [css, dict] of STATIC_SCOPES) applyScoped(root, css, dict);
    for (const [css, dict] of DYNAMIC_SCOPES) applyScoped(root, css, dict);
    translateAttributes(root);
}

/* ---- 空闲批处理调度 ---- */
const translatedNodes = new WeakSet();
// 引擎自己写过的最终值(文本/属性),用于识别"自己触发的变更",
// 避免自身写入 → observer → 重扫 的自反馈洪水(性能事故根因之一)
const lastTextWrite = new WeakMap();
const lastAttrWrite = new WeakMap();
const pendingRoots = [];
const pendingRootSet = new Set();
let scheduled = false;

/** 单轮处理预算:超出的根留到下一轮空闲,避免一次性冻结页面数秒 */
const FLUSH_BUDGET = 300;

function pushRoot(root) {
    if (pendingRootSet.has(root)) return;
    // 洪水合并:队列过长时直接退化为全页一根,本轮扫描总量有上界
    if (pendingRoots.length >= FLUSH_BUDGET) {
        for (const r of pendingRoots) pendingRootSet.delete(r);
        pendingRoots.length = 0;
        pendingRoots.push(document.body);
        pendingRootSet.add(document.body);
        return;
    }
    pendingRoots.push(root);
    pendingRootSet.add(root);
}

function schedule() {
    if (scheduled) return;
    scheduled = true;
    const run = () => { scheduled = false; flushPending(); };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1000 });
    else setTimeout(run, 150);
}

function flushPending() {
    if (!pendingRoots.length) return;
    const roots = pendingRoots.splice(0);
    for (const r of roots) pendingRootSet.delete(r);
    let processed = 0;
    for (const root of roots) {
        if (processed >= FLUSH_BUDGET && document.body) {
            // 剩余根放回队列,等下一个空闲周期
            for (const r of roots.slice(processed)) {
                if (!pendingRootSet.has(r)) { pendingRoots.push(r); pendingRootSet.add(r); }
            }
            schedule();
            break;
        }
        processed++;
        try {
            processRoot(root);
        } catch (e) {
            console.warn('[SteamDB中文] 处理节点失败:', e);
        }
    }
}

function processAll() {
    if (!document.body) return;
    pushRoot(document.body);
    schedule();
}

/* ---- 动态内容生命周期 ---- */
const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
        for (const node of m.addedNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                // 脱离文档的临时文本节点(渲染框架水合时大量产生)直接忽略:
                // 它真正被插入时会以父元素的 childList 变更进来,届时再扫父元素,
                // 绝不能对每个孤立节点都退化为全页扫描(性能事故根因)
                if (!node.parentElement) continue;
                translatedNodes.delete(node);
                pushRoot(node.parentElement);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                pushRoot(node);
            }
        }
        // 框架就地改文本:先排除引擎自己的回写,只对"别人改的"解除标记重查
        if (m.type === 'characterData' && m.target && m.target.nodeType === Node.TEXT_NODE && m.target.parentElement) {
            if (lastTextWrite.get(m.target) === m.target.nodeValue) {
                translatedNodes.add(m.target);
            } else {
                translatedNodes.delete(m.target);
                pushRoot(m.target.parentElement);
            }
        }
        // 动态改 placeholder/aria-label:轻量直译该元素属性,不整树重扫
        if (m.type === 'attributes' && m.target && m.target.nodeType === Node.ELEMENT_NODE) {
            if (m.attributeName && lastAttrWrite.get(m.target) === m.attributeName + '\0' + m.target.getAttribute(m.attributeName)) {
                continue; // 引擎自己的回写,跳过
            }
            try { translateAttributes(m.target); } catch (e) { console.warn('[SteamDB中文] 属性翻译失败:', e); }
        }
    }
    schedule();
});

function start() {
    if (!document.body) return;
    document.documentElement.setAttribute('lang', 'zh-CN');
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['placeholder', 'aria-label'],
    });
    registerMenu();
    processAll();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
} else {
    start();
}

console.info(
    '[SteamDB中文] v' + __VERSION + ' 已加载,词库 v' + __DICT_VERSION +
    '(' + __ENTRY_COUNT + ' 词条)'
);
