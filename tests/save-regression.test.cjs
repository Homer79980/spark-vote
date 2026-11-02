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
    const context = vm.createContext({ document, console, Blob, TextEncoder, URL, Promise, SparkNumbers: require('../number-voting.js'),
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

test('double-click during local draft persistence sends only one server write', async () => {
    const app = setup([row({name:'图片'})]);
    await Promise.all([app.context.saveAll(),app.context.saveAll()]);
    assert.equal(app.writes.length,1);
});

test('a recovered draft already committed remotely is recognized without resetting votes', async () => {
    const app = setup([row({name:'图片'})]);
    app.server.data = {items:[{name:'图片',group:'测试组',url:'data:image/jpeg;base64,AA==',votes:7}],round:0,maxVotes:1};
    await app.context.saveAll();
    assert.equal(app.writes.length,1);
    assert.equal(app.writes[0].items[0].votes,7);
    assert.match(app.elements.get('save-status').textContent,/保存成功/);
});

test('editing an existing item preserves additional server metadata', async () => {
    const old = {name:'旧名称',url:'data:image/jpeg;base64,AA==',group:'测试组',votes:3,assetId:'keep-me'};
    const app = setup([row({name:'新名称',originalIndex:'0'})],{items:[old],round:0,maxVotes:1});
    await app.context.saveAll();
    assert.equal(app.writes[0].items[0].assetId,'keep-me');
});

test('saving image edits keeps numbered ballots that arrived while editing', async () => {
    const old = {name:'24_2301-2400',url:'data:image/jpeg;base64,AA==',group:'测试组',votes:3};
    const app = setup([row({name:'24_2301-2400',originalIndex:'0',group:'新组'})],{items:[old],round:0,maxVotes:1});
    app.server.data.numberBallots = {r0:{voter:{n2358:true}},r1:{archived:{n2301:true}}};
    app.server.data.numberBallotsV2 = {r0:{voter:{n2358:4,_format:2}}};
    await app.context.saveAll();
    assert.equal(app.writes[0].numberBallots.r0.voter.n2358,true);
    assert.equal(app.writes[0].numberBallots.r1.archived.n2301,true);
    assert.equal(app.writes[0].numberBallotsV2.r0.voter.n2358,4);
    assert.equal(app.writes[0].items[0].votes,3);
});

test('overlapping numbered uploads fail validation without replacing server items', async () => {
    const app=setup([row({name:'23_2201-2300'}),row({name:'24_2250-2350'})]);
    await app.context.saveAll();
    assert.equal(app.writes.length,0);
    assert.match(app.elements.get('save-status').textContent,/重叠/);
});

test('number CSV excludes earlier rounds, preserves legacy votes, and escapes spreadsheet formulas', () => {
    const app=setup([],{items:[{name:'24_2301-2400',url:'x',group:'=SUM(1,2)',votes:3}],round:1,
        numberBallots:{r0:{old:{n2301:true}},r1:{one:{n2358:true}}},numberBallotsV2:{r1:{one:{n2358:3,_format:2}}}});
    const csv=app.context.buildExportCsv();
    assert.match(csv,/"2358","1"/);
    assert.match(csv,/"2301","0"/);
    assert.match(csv,/"'=SUM\(1,2\)"/);
    assert.match(csv,/原整图投票记录/);
    assert.match(csv,/"24_2301-2400","3"/);
});
