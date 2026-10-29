const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1];

function setup(rows = [], initialData = {items:[],round:0,maxVotes:1}) {
    const writes = [], alerts = [], listeners = {};
    const server = {data:initialData,error:null};
    const elements = new Map();
    function element() {
        return { value: '1', textContent: '', innerText: '', innerHTML: '', style: {}, dataset: {},
            disabled: false, hidden: false, classList: { add() {}, remove() {}, toggle() {} },
            addEventListener() {}, querySelectorAll: () => [], appendChild() {},
            querySelector: () => element(), setAttribute() {}, removeAttribute() {} };
    }
    const document = {
        addEventListener() {}, body: element(),
        getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
        querySelectorAll: selector => selector === '#admin-list .admin-item' ? rows : [],
        createElement: element
    };
    const db = { ref(key) { return {
        on(event, fn) { listeners[key] = fn; },
        update(payload) { writes.push(payload); return Promise.resolve(); },
        transaction(fn) { if (server.error) return Promise.reject(server.error); const value = fn(server.data); if (value === undefined) return Promise.resolve({committed:false}); writes.push(value); server.data=value; return Promise.resolve({committed:true,snapshot:{val:()=>value}}); }
    }; } };
    const context = vm.createContext({ document, console, Blob, TextEncoder, URL, Promise,
        firebase: { initializeApp() {}, database: () => db },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        window: { addEventListener() {} }, setTimeout: () => 1, clearTimeout() {},
        alert: message => alerts.push(message), confirm: () => true });
    vm.runInContext(script, context);
    vm.runInContext('renderUserView = () => {}; updateDashboard = () => {}; updateGroupSuggestions = () => {};', context);
    listeners['.info/connected']?.({val:()=>true});
    listeners.sparkVote({val:()=>initialData});
    vm.runInContext('renderAdminView(currentData.items || []);', context);
    return { context, writes, alerts, listeners, elements, db, server };
}

function row({name='', url='data:image/jpeg;base64,AA==', group='测试组',originalIndex=''}={}) {
    const fields = { '.edit-name':{value:name}, '.edit-url':url===null?null:{value:url}, '.edit-group':{value:group} };
    return { dataset:{originalIndex}, querySelector:s=>fields[s] ?? null };
}

test('an uploaded image with no name must not be silently discarded by Save', async () => {
    const app = setup([row()]);
    await app.context.saveAll();
    assert.ok(app.writes.length === 0 || app.writes[0].items?.length === 1,
        'Save wrote an empty item list and discarded the uploaded image');
    if (!app.writes.length) assert.ok(app.alerts.length || /名称|未命名/.test(app.elements.get('save-status')?.textContent || ''), 'validation must tell the user why saving stopped');
});

test('saving during image decoding must not throw or discard the row', async () => {
    const app = setup([row({name:'图片',url:null})]);
    await assert.doesNotReject(async()=>app.context.saveAll());
    assert.equal(app.writes.length,0);
});

test('a realtime vote update must preserve unfinished admin edits', () => {
    const app = setup();
    vm.runInContext('isAdmin = true; addNewRow(); globalThis.renderCount = 0; renderAdminView = () => { renderCount++; };', app.context);
    app.listeners.sparkVote({val:()=>({items:[],round:0,maxVotes:1,headcount:1})});
    assert.equal(app.context.renderCount,0,'Realtime listener rebuilt the editor and erased the draft');
});

test('a valid image is saved and success is shown only after server confirmation', async () => {
    const app = setup([row({name:'图片'})]);
    await app.context.saveAll();
    assert.equal(app.writes.length,1);
    assert.equal(app.writes[0].items[0].name,'图片');
    assert.match(app.elements.get('save-status').textContent,/保存成功/);
});

test('saving metadata preserves votes received since editing began', async () => {
    const old = {name:'旧名称',url:'data:image/jpeg;base64,AA==',group:'测试组',votes:3};
    const app = setup([row({name:'新名称',originalIndex:'0'})],{items:[old],round:1,maxVotes:1,headcount:2});
    app.server.data = {items:[{...old,votes:6}],round:1,maxVotes:1,headcount:4};
    await app.context.saveAll();
    assert.equal(app.writes[0].items[0].votes,6);
    assert.equal(app.writes[0].headcount,4);
});

test('server rejection does not show success or discard dirty state', async () => {
    const app = setup([row({name:'图片'})]);
    app.context.markAdminDirty();
    app.server.error = new Error('PERMISSION_DENIED');
    await app.context.saveAll();
    assert.equal(app.writes.length,0);
    assert.match(app.elements.get('save-status').textContent,/保存失败.*PERMISSION_DENIED/);
    assert.equal(vm.runInContext('adminDirty',app.context),true);
});

test('concurrent option edits abort without overwriting remote items', async () => {
    const app = setup([row({name:'图片'})]);
    app.server.data = {items:[{name:'另一管理员新建',url:'x',group:'组'}]};
    await app.context.saveAll();
    assert.equal(app.writes.length,0);
    assert.match(app.elements.get('save-status').textContent,/其他管理员/);
});

test('offline save preserves the draft without issuing a write', async () => {
    const app = setup([row({name:'图片'})]);
    app.listeners['.info/connected']({val:()=>false});
    await app.context.saveAll();
    assert.equal(app.writes.length,0);
    assert.match(app.elements.get('save-status').textContent,/尚未连接/);
});
