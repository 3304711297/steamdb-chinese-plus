/**
 * i18n-core.mjs 纯函数单元测试(node:test 内置运行器,零依赖)
 *
 * 运行:node --test tests/i18n-core.test.mjs
 *
 * build.mjs 把本模块内联进 userscript(去掉 export),测试通过 import 保证
 * 浏览器端跑的翻译逻辑与这里的断言完全同源。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_TEXT_LENGTH,
    normalizeKey,
    validateLocales,
    mergeLocales,
    lookupSimple,
    compileRules,
    lookupRegex,
} from '../i18n-core.mjs';

describe('normalizeKey', () => {
    test('去首尾空格并折叠空白', () => {
        assert.strictEqual(normalizeKey('  Pricing  '), 'Pricing');
        assert.strictEqual(normalizeKey('Sort\n  by'), 'Sort by');
        assert.strictEqual(normalizeKey(undefined), '');
    });
});

describe('validateLocales(词库整体合法性——防上游格式变更悄悄产出空词库)', () => {
    const valid = {
        DOC: { '更新时间': '2026-1-21' },
        STATIC: { h1: { Home: '首页' } },
        INPUT: { Search: '搜索' },
        LABEL: { Close: '关闭' },
        DYNAMIC: { '#box': { Load: '加载' } },
    };

    test('合法词库返回 null', () => {
        assert.strictEqual(validateLocales(valid), null);
    });

    test('各类缺失/损坏被识别', () => {
        assert.match(validateLocales(null), /顶层/);
        assert.match(validateLocales({ STATIC: {} }), /选择器为 0/);
        assert.match(validateLocales({ STATIC: { h1: 42 } }), /不是对象/);
        assert.match(validateLocales({ STATIC: { h1: {} }, INPUT: [] }), /INPUT/);
        assert.match(
            validateLocales({ STATIC: { h1: { A: 'a' } }, DYNAMIC: { '': {} } }),
            /DYNAMIC/
        );
        // 全部词典为空(有效词条 0)也要拦下——STATIC 空选择器已在上面覆盖,这里测全空
        assert.match(validateLocales({ STATIC: { h1: {} }, INPUT: {}, LABEL: {} }), /有效词条为 0/);
    });
});

describe('mergeLocales(补充词库合并——补充词覆盖上游,上游快照不被改动)', () => {
    const base = {
        DOC: { '更新时间': '2026-1-21' },
        STATIC: {
            'h1,a': { Home: '首页', Pricing: '定价' },
            'td': { 'Last Update': '上次更新' },
        },
        INPUT: { Search: '搜索' },
        LABEL: { Close: '关闭' },
        DYNAMIC: { '#js-notifications': { 'Sign in': '登录' } },
    };
    const supplement = {
        DOC: { '说明': '真机漏翻' },
        STATIC: {
            'h1,a': { Home: '主页', Apps: '应用' },
            'button': { Follow: '关注' },
        },
        INPUT: { 'Search apps': '搜索应用' },
        DYNAMIC: { '#js-notifications': { 'Sign in': '登录 Steam' } },
    };

    test('同选择器词条覆盖、新选择器与新区段追加', () => {
        const m = mergeLocales(base, supplement);
        assert.strictEqual(m.STATIC['h1,a'].Home, '主页'); // 覆盖
        assert.strictEqual(m.STATIC['h1,a'].Pricing, '定价'); // 保留
        assert.strictEqual(m.STATIC['h1,a'].Apps, '应用'); // 追加
        assert.strictEqual(m.STATIC.button.Follow, '关注'); // 新选择器
        assert.strictEqual(m.INPUT['Search apps'], '搜索应用');
        assert.strictEqual(m.DYNAMIC['#js-notifications']['Sign in'], '登录 Steam');
        assert.strictEqual(m.LABEL.Close, '关闭'); // 未涉及的段原样保留
    });

    test('不改入参,DOC 记录补充词库来源', () => {
        mergeLocales(base, supplement);
        assert.strictEqual(base.STATIC['h1,a'].Home, '首页');
        const m = mergeLocales(base, supplement);
        assert.strictEqual(m.DOC['更新时间'], '2026-1-21');
        assert.deepStrictEqual(m.DOC['补充词库'], { '说明': '真机漏翻' });
    });

    test('supplement 为 null 时原样拷贝 base', () => {
        const m = mergeLocales(base, null);
        assert.strictEqual(m.STATIC.td['Last Update'], '上次更新');
        assert.strictEqual(m.DOC['补充词库'], undefined);
    });

    test('REGEX-only 补充词库:REGEX 追加、其余段保持 base(build 判断曾漏掉此形态)', () => {
        const regexOnly = { REGEX: [['^a (\\d+)$', 'a $1']] };
        const m = mergeLocales(base, regexOnly);
        assert.strictEqual(m.REGEX.length, 1);
        assert.strictEqual(m.STATIC['h1,a'].Home, '首页');
        assert.strictEqual(m.DOC['补充词库'], undefined); // 无 DOC 不记来源
    });
});

describe('compileRules / lookupRegex(动态文案正则——分页信息/计数)', () => {
    const rules = compileRules([
        ['^Showing (\\d+) to (\\d+) of ([\\d,]+) entries$', '显示第 $1 至 $2 项,共 $3 项'],
        ['^([\\d,]+) products match your filters$', '$1 个商品符合筛选条件'],
        ['([unclosed', '坏规则'],
    ]);

    test('捕获组替换', () => {
        assert.strictEqual(
            lookupRegex(rules, 'Showing 1 to 100 of 1,465 entries'),
            '显示第 1 至 100 项,共 1,465 项'
        );
        assert.strictEqual(lookupRegex(rules, '1,465 products match your filters'), '1,465 个商品符合筛选条件');
    });

    test('非法正则被丢弃,不影响其余规则', () => {
        assert.strictEqual(rules.length, 2);
    });

    test('未命中/替换结果相同返回 null', () => {
        assert.strictEqual(lookupRegex(rules, 'nothing matches this'), null);
        const same = compileRules([['^foo$', 'foo']]);
        assert.strictEqual(lookupRegex(same, 'foo'), null);
    });

    test('REGEX 段非法结构被 validateLocales 拒绝', () => {
        assert.match(validateLocales({ STATIC: { h1: { A: 'a' } }, REGEX: {} }), /REGEX/);
        assert.strictEqual(
            validateLocales({ STATIC: { h1: { A: 'a' } }, REGEX: ['^x$', 'y'] }),
            null
        );
    });
});

describe('lookupSimple(INPUT/LABEL 简单词典查找)', () => {
    const dict = { Search: '搜索', 'Sort by': '排序方式' };

    test('命中与空白规范化', () => {
        assert.strictEqual(lookupSimple(dict, 'Search'), '搜索');
        assert.strictEqual(lookupSimple(dict, '  Sort   by '), '排序方式');
    });

    test('超长/无字母文本直接剪枝', () => {
        assert.strictEqual(lookupSimple(dict, 'a'.repeat(MAX_TEXT_LENGTH + 1)), null);
        assert.strictEqual(lookupSimple(dict, '123'), null);
    });

    test('未命中返回 null', () => {
        assert.strictEqual(lookupSimple(dict, 'Nope'), null);
    });
});
