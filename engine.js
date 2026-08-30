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
    // 只替换首个命中段,保留原文的前导/尾随空白
    textNode.nodeValue = text.replace(trimmed, zh);
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
        if (zh !== null) el.setAttribute('placeholder', raw.replace(raw.trim(), zh));
        else logUnmatched(raw, 'placeholder');
    }
    const labelled = root.matches && root.matches('[aria-label]')
        ? [root, ...root.querySelectorAll('[aria-label]')]
        : root.querySelectorAll('[aria-label]');
    for (const el of labelled) {
        const raw = el.getAttribute('aria-label');
        if (!raw) continue;
        const zh = lookupSimple(LABEL_DICT, raw);
        if (zh !== null) el.setAttribute('aria-label', raw.replace(raw.trim(), zh));
        else logUnmatched(raw, 'aria-label');
    }
}

function processRoot(root) {
    for (const [css, dict] of STATIC_SCOPES) applyScoped(root, css, dict);
    for (const [css, dict] of DYNAMIC_SCOPES) applyScoped(root, css, dict);
    translateAttributes(root);
}

/* ---- 空闲批处理调度 ---- */
const translatedNodes = new WeakSet();
const pendingRoots = [];
let scheduled = false;

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
    for (const root of roots) {
        try {
            processRoot(root);
        } catch (e) {
            console.warn('[SteamDB中文] 处理节点失败:', e);
        }
    }
}

function processAll() {
    if (!document.body) return;
    pendingRoots.push(document.body);
    schedule();
}

/* ---- 动态内容生命周期 ---- */
const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
        for (const node of m.addedNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                translatedNodes.delete(node);
                pendingRoots.push(node.parentElement || document.body);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                pendingRoots.push(node);
            }
        }
        // 框架就地改文本(表格排序常见):解除标记后以父元素为界重查
        if (m.type === 'characterData' && m.target && m.target.nodeType === Node.TEXT_NODE && m.target.parentElement) {
            translatedNodes.delete(m.target);
            pendingRoots.push(m.target.parentElement);
        }
        // 动态改 placeholder/aria-label:轻量直译该元素属性,不整树重扫。
        // 自己写回的中文值无字母,重查必然空跑,不会死循环
        if (m.type === 'attributes' && m.target && m.target.nodeType === Node.ELEMENT_NODE) {
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
