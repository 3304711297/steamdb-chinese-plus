/**
 * 词条优先级回归测试(README「词条优先级」章节的行为契约)
 *
 * 覆盖两种冲突场景:
 *   1. 同 key 覆盖:supplement 同 key 词条覆盖 base,优先生效
 *   2. 上游 key 更名:同步只保留新 key,旧 key 的自有翻译不自动迁移,
 *      由维护者按需在 supplement 中人工迁移/补录
 *
 * 运行:node --test tests/word-priority.test.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mergeLocales } from '../i18n-core.mjs';

describe('词条优先级:base → supplement 覆盖 → build', () => {
    test('同 key 覆盖:supplement 译文优先于 base', () => {
        const base = {
            STATIC: { 'nav a': { Settings: '设置', Home: '首页' } },
        };
        const supplement = {
            STATIC: { 'nav a': { Settings: '设定' } },
        };
        const merged = mergeLocales(base, supplement);
        // 同 key:supplement 覆盖 base
        assert.strictEqual(merged.STATIC['nav a'].Settings, '设定');
        // 未被 supplement 涉及的 base 词条原样保留
        assert.strictEqual(merged.STATIC['nav a'].Home, '首页');
        // 覆盖不改写 supplement 自身
        assert.strictEqual(supplement.STATIC['nav a'].Settings, '设定');
        // INPUT/LABEL 同键覆盖走同一契约
        const m2 = mergeLocales(
            { STATIC: { h1: { A: 'a' } }, INPUT: { Search: '搜索' } },
            { INPUT: { Search: '搜寻' } }
        );
        assert.strictEqual(m2.INPUT.Search, '搜寻');
    });

    test('上游 key 更名:保留新 key(上游译文),旧 key 自有翻译不自动迁移', () => {
        // 场景:上游把 "Settings" 更名为 "Display" 并删除旧 key,
        // supplement 里仍留着旧 key 的自有翻译(尚未人工迁移)
        const base = {
            STATIC: { 'nav a': { Display: '显示' } }, // 上游只有新 key
        };
        const supplement = {
            STATIC: { 'nav a': { Settings: '设定' } }, // 旧 key 的自有翻译,待人工迁移
        };
        const merged = mergeLocales(base, supplement);
        // 新 key 保留,使用上游译文(同步不会因旧 key 有自有翻译而改动新 key)
        assert.strictEqual(merged.STATIC['nav a'].Display, '显示');
        // 旧 key 不会被自动迁移:supplement 的旧词条不会作用于新 key
        assert.notStrictEqual(merged.STATIC['nav a'].Display, '设定');
        // 旧 key 的自有翻译保持原样(交由人工决定去留/迁移)
        assert.strictEqual(merged.STATIC['nav a'].Settings, '设定');
        // 合并是纯函数,supplement 原始快照不被改写
        assert.deepStrictEqual(supplement.STATIC['nav a'], { Settings: '设定' });
    });
});
