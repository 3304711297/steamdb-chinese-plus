/**
 * i18n-core —— 纯函数翻译核心(无 DOM 依赖)
 *
 * 既是构建产物的一部分(build.mjs 内联进 userscript,此时去掉 export),
 * 也是单元测试的直接被测对象(node:test 导入)。因此本文件:
 *   - 不得引用 document/window/GM_* 等浏览器 API
 *   - 不得有模块顶层副作用
 *
 * 词库格式(来自 Chr_/GM_Scripts SteamDB_CN.json,AGPL-3.0):
 *   {
 *     DOC:      { "更新时间": "...", ... },
 *     STATIC:   { "CSS选择器": { "英文": "中文", ... }, ... },  // 作用域静态词典
 *     INPUT:    { "placeholder原文": "中文", ... },
 *     LABEL:    { "aria-label原文": "中文", ... },
 *     DYNAMIC:  { "CSS选择器": { "英文": "中文", ... }, ... }   // 作用域动态词典
 *   }
 */

/** 文本参与查找的最大长度:词库键都是短 UI 文案,长文本必是正文/数字,直接跳过 */
export const MAX_TEXT_LENGTH = 120;

/** 纯符号/无字母文本(如 "···"、纯数字、标点)不可能命中词库,提前剪枝 */
const HAS_LETTER = /[a-zA-Z]/;

/** 规范化查找键:去首尾空格、折叠空白 */
export function normalizeKey(text) {
    return typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '';
}

function isDict(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 词库整体合法性校验(merge 与 build 时兜底,防上游格式变更悄悄产出空词库)。
 * 返回 null 表示合法,否则返回错误描述字符串。
 */
export function validateLocales(locales) {
    if (!isDict(locales)) return '顶层不是对象';
    if (!isDict(locales.STATIC)) return 'STATIC 缺失或类型非法';
    if (Object.keys(locales.STATIC).length === 0) return 'STATIC 选择器为 0';
    let entries = 0;
    for (const [css, dic] of Object.entries(locales.STATIC)) {
        if (!css) return 'STATIC 存在空选择器';
        if (!isDict(dic)) return `STATIC["${css}"] 不是对象`;
        entries += Object.keys(dic).length;
    }
    for (const section of ['INPUT', 'LABEL', 'DYNAMIC']) {
        if (locales[section] !== undefined && !isDict(locales[section])) {
            return `${section} 不是对象`;
        }
        if (section === 'DYNAMIC' && isDict(locales.DYNAMIC)) {
            for (const [css, dic] of Object.entries(locales.DYNAMIC)) {
                if (!css || !isDict(dic)) return `DYNAMIC["${css}"] 结构非法`;
            }
        }
    }
    for (const section of ['INPUT', 'LABEL']) {
        const dic = locales[section];
        if (isDict(dic)) entries += Object.keys(dic).length;
    }
    if (entries === 0) return '有效词条为 0';
    return null;
}

/**
 * 合并自有补充词库(supplement)到上游词库(base),返回新对象不改入参:
 *   - STATIC:按选择器合并,supplement 同选择器词条覆盖 base,新选择器追加
 *   - INPUT/LABEL:键值直接覆盖合并
 *   - DYNAMIC:同 STATIC 按选择器合并
 *   - DOC:保留 base 的 DOC;supplement 的 DOC 用 "补充词库" 键记入,便于溯源
 */
export function mergeLocales(base, supplement) {
    const merged = {
        DOC: { ...(isDict(base.DOC) ? base.DOC : {}) },
        STATIC: {},
        INPUT: { ...(isDict(base.INPUT) ? base.INPUT : {}) },
        LABEL: { ...(isDict(base.LABEL) ? base.LABEL : {}) },
        DYNAMIC: {},
    };
    const mergeScoped = (dst, src) => {
        if (!isDict(src)) return;
        for (const [css, dic] of Object.entries(src)) {
            if (!isDict(dic)) continue;
            dst[css] = { ...(dst[css] || {}), ...dic };
        }
    };
    mergeScoped(merged.STATIC, base.STATIC);
    mergeScoped(merged.DYNAMIC, base.DYNAMIC);
    if (isDict(supplement)) {
        mergeScoped(merged.STATIC, supplement.STATIC);
        mergeScoped(merged.DYNAMIC, supplement.DYNAMIC);
        for (const section of ['INPUT', 'LABEL']) {
            if (isDict(supplement[section])) Object.assign(merged[section], supplement[section]);
        }
        if (isDict(supplement.DOC)) merged.DOC['补充词库'] = supplement.DOC;
    }
    return merged;
}

/**
 * 简单词典(INPUT/LABEL/无作用域场景)查找:静态词优先,未命中返回 null。
 * 长度超限、无字母文本直接返回 null(性能剪枝)。
 */
export function lookupSimple(dict, text) {
    if (typeof text !== 'string') return null;
    const key = normalizeKey(text);
    if (!key || key.length > MAX_TEXT_LENGTH || !HAS_LETTER.test(key)) return null;
    return dict[key] ?? null;
}
