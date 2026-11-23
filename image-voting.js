(function (root) {
    'use strict';
    const cache = new WeakMap();
    function id(item) {
        if (!item) return '';
        if (item.imageId) return item.imageId;
        if (cache.has(item)) return cache.get(item);
        // Existing images have no stored ID. Freeze this key on their next admin save.
        let a = 2166136261, b = 5381;
        for (const part of [item.group || '', item.name || '', item.url || '']) {
            for (let i=0; i<=part.length; i++) {
                const c = i===part.length ? 65535 : part.charCodeAt(i);
                a = Math.imul(a ^ c, 16777619); b = Math.imul(b, 33) ^ c;
            }
        }
        const key = 'old_' + (a>>>0).toString(36) + '_' + (b>>>0).toString(36);
        cache.set(item,key); return key;
    }
    function ballots(data) { return data.imageBallots?.['r' + (data.round||0)] || {}; }
    function summary(data) {
        const counts = Object.create(null);
        let people = data.headcount || 0;
        for (const ballot of Object.values(ballots(data))) {
            if (ballot._newParticipant === true) people++;
            for (const key of Object.keys(ballot)) if (key !== '_newParticipant' && ballot[key] === true) counts[key]=(counts[key]||0)+1;
        }
        return {counts,people};
    }
    function used(items, ballot, group, legacy) {
        return (Array.isArray(legacy?.[group]) ? legacy[group].length : 0) +
            items.filter(item => (item.group||'默认分组') === group && ballot[id(item)] === true).length;
    }
    const api = {id,ballots,summary,used};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.SparkImages = api;
})(globalThis);
