(function (root) {
    'use strict';
    const LIMIT = 20;
    function range(name) {
        const stem = String(name || '').normalize('NFKC').replace(/\.(png|jpe?g|webp|gif|bmp|avif)$/i, '').trim();
        const match = stem.match(/(?:^|[_\s])(\d{1,7})\s*[-–—~～]\s*(\d{1,7})$/);
        if (!match) return null;
        const start = Number(match[1]), end = Number(match[2]);
        return start > 0 && end >= start && end <= 1000000 && end - start < 10000 ? {start, end} : null;
    }
    function parseNumber(value) {
        const text = String(value ?? '').normalize('NFKC').trim();
        return /^\d{1,7}$/.test(text) && Number(text) > 0 && Number(text) <= 1000000 ? Number(text) : null;
    }
    function find(items, value) {
        const number = parseNumber(value);
        if (number === null) return {error: '请输入有效的数字编号，例如 2358。'};
        const matches = (items || []).map((item, index) => ({item, index, range: range(item?.name)}))
            .filter(entry => entry.range && number >= entry.range.start && number <= entry.range.end);
        if (!matches.length) return {error: `未找到 ${number} 号，请核对编号及总览图是否已上传。`};
        if (matches.length > 1) return {error: `${number} 号对应多张总览图，请管理员先修正重复的编号范围。`};
        return {number, ...matches[0]};
    }
    function overlap(items) {
        const ranges = (items || []).map(item => ({name:item.name, ...range(item.name)})).filter(item => item.start)
            .sort((a, b) => a.start - b.start);
        for (let index = 1; index < ranges.length; index++) {
            if (ranges[index].start <= ranges[index - 1].end) return `${ranges[index - 1].name} 与 ${ranges[index].name} 的编号范围重叠`;
        }
        return '';
    }
    function choices(ballot) {
        return Object.entries(ballot || {}).filter(([key, value]) => /^n[1-9]\d{0,6}$/.test(key) && value === true && parseNumber(key.slice(1)) !== null)
            .map(([key]) => Number(key.slice(1))).sort((a, b) => a - b);
    }
    function change(ballot, number, selected) {
        if (parseNumber(number) === null) return undefined;
        const key = `n${Number(number)}`, next = {...(ballot || {})};
        if (selected) {
            if (next[key] !== true && choices(next).length >= LIMIT) return undefined;
            next[key] = true;
        } else {
            delete next[key];
        }
        return next;
    }
    function summarize(ballots) {
        const counts = new Map();
        let participants = 0, total = 0;
        for (const ballot of Object.values(ballots || {})) {
            const selected = choices(ballot);
            if (selected.length) participants++;
            for (const number of selected) { counts.set(number, (counts.get(number) || 0) + 1); total++; }
        }
        return {participants, total, counts, ranking: [...counts].map(([number, votes]) => ({number, votes}))
            .sort((a, b) => b.votes - a.votes || a.number - b.number)};
    }
    const api = {LIMIT, range, parseNumber, find, overlap, choices, change, summarize};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.SparkNumbers = api;
})(globalThis);
