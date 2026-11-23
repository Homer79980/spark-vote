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
    const context = vm.createContext({ document, console, Blob, TextEncoder, URL, Promise, crypto:require('node:crypto').webcrypto, SparkImages:require('../image-voting.js'), SparkNumbers: require('../number-voting.js'),
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

test('a 20 MiB gallery survives a concurrent ballot and an independent read after Save', async () => {
    const gallery = Array.from({length:5}, (_,i)=>row({name:'图'+i,url:'data:image/webp;base64,'+'A'.repeat(4*1024*1024)}));
    const app = setup(gallery);
    let remote={round:0,maxVotes:1}, version=1, attempts=0;
    app.context.fetch=async (_url,options={})=>{
        if (options.method!=='PUT') return Response.json(remote,{headers:{ETag:String(version)}});
        attempts++;
        if (attempts===1) { remote.imageBallots={r0:{person:{sample:true}}}; version++; }
        if (options.headers['if-match']!==String(version)) return Response.json(remote,{status:412,headers:{ETag:String(version)}});
        remote=JSON.parse(options.body); version++;
        return new Response(null,{status:204});
    };
    await app.context.saveAll();
    assert.match(app.elements.get('save-status').textContent,/保存成功/);
    const refreshed=await (await app.context.fetch('')).json();
    assert.equal(attempts,2);
    assert.equal(refreshed.items.length,5);
    assert.equal(refreshed.items[4].url,gallery[4].querySelector('.edit-url').value);
    assert.deepEqual(refreshed.imageBallots,{r0:{person:{sample:true}}});
});

test('an uploaded image with no name must not be silently discarded by Save', async () => {
    const app = setup([row()]);
    await app.context.saveAll();
    assert.ok(app.writes.length === 0 || app.writes[0].items?.length === 1,
        'Save wrote an empty item list and discarded the uploaded image');
    if (!app.writes.length) assert.ok(app.alerts.length || /名称|未命名/.test(app.elements.get('save-status')?.textContent || ''), 'validation must tell the user why saving stopped');
});

test('above 64 MiB the editor displays the limit and keeps the pending rows without any remote write',async()=>{
    const url='data:image/webp;base64,'+'A'.repeat(4*1024*1024);
    const app=setup(Array.from({length:16},(_,i)=>row({name:'图'+i,url})));
    await app.context.saveAll();
    assert.equal(app.writes.length,0);
    assert.match(app.elements.get('gallery-capacity').textContent,/超出上限/);
    assert.match(app.elements.get('save-status').textContent,/64 MiB.*已保留/);
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

test('concurrent additions are merged without overwriting remote items', async () => {
    const app = setup([row({name:'图片'})]);
    app.server.data = {items:[{name:'另一管理员新建',url:'x',group:'组'}]};
    await app.context.saveAll();
    assert.deepEqual(Array.from(app.server.data.items, item => item.name), ['另一管理员新建','图片']);
});

test('a new round cannot silently restore an old draft', async () => {
    const app = setup([row({name:'图片'})]);
    app.server.data = {items:[],round:1,maxVotes:1};
    await app.context.saveAll();
    assert.equal(app.writes.length,0);
    assert.match(app.elements.get('save-status').textContent,/其他管理员/);
    assert.equal(app.elements.get('merge-draft-button').hidden,false);
    await app.context.saveAll(true);
    assert.equal(app.server.data.round,1);
    assert.equal(app.server.data.items[0].name,'图片');
});

test('simultaneous edits to the same setting still refuse to overwrite', async () => {
    const app = setup([row({name:'图片'})]);
    app.elements.get('maxVoteInput').value='3';
    app.server.data = {items:[],round:0,maxVotes:2};
    await app.context.saveAll();
    assert.equal(app.writes.length,0);
    assert.match(app.elements.get('save-status').textContent,/每组限投票数/);
    await app.context.saveAll(true);
    assert.equal(app.server.data.items.length,1);
    assert.equal(app.server.data.maxVotes,2);
});

test('merge does not duplicate a previously committed image', async () => {
    const app = setup([row({name:'图片'})]);
    app.server.data = {items:[{name:'图片',url:'data:image/jpeg;base64,AA==',group:'测试组',votes:7}],round:0,maxVotes:2};
    await app.context.saveAll(true);
    assert.equal(app.server.data.items.length,1);
    assert.equal(app.server.data.items[0].votes,7);
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

test('number uploads require a usable range and accept manual start and end without another upload', async () => {
    const r=row({name:'概念图'});const orig=r.querySelector;
    const fields={'.range-start':{value:''},'.range-end':{value:''}};
    r.querySelector=s=>fields[s]||orig(s);
    const app=setup([r]);app.elements.get('voteMode').value='number';
    await app.context.saveAll();assert.equal(app.writes.length,0);
    assert.match(app.elements.get('save-status').textContent,/概念图.*编号范围/);
    fields['.range-start'].value='101';fields['.range-end'].value='105';await app.context.saveAll();
    assert.equal(app.server.data.items[0].name,'概念图_101-105');
    assert.equal(app.context.SparkNumbers.find(app.server.data.items,103).index,0);
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

test('admin chooses a voting mode and existing ballots remain intact', async () => {
    const initial={items:[{name:'24_2301-2400',url:'data:image/jpeg;base64,AA==',group:'测试组',votes:3}],round:0,maxVotes:1,numberBallotsV2:{r0:{one:{n2358:1}}}};
    const app=setup([row({name:'24_2301-2400',originalIndex:'0'})],initial);
    app.elements.get('voteMode').value='image';
    await app.context.saveAll();
    assert.equal(app.server.data.voteMode,'image');
    assert.equal(app.server.data.numberBallotsV2.r0.one.n2358,1);
    assert.equal(vm.runInContext('usesNumberVoting(currentData.items[0])',app.context),false);
    app.elements.get('voteMode').value='number';
    await app.context.saveAll();
    assert.equal(app.server.data.voteMode,'number');
    assert.equal(vm.runInContext('usesNumberVoting(currentData.items[0])',app.context),true);
});

test('admin mode selection immediately shows the corresponding rules', () => {
    const app=setup();
    vm.runInContext('isAdmin = true; adminDirty = true',app.context);
    app.elements.get('voteMode').value='image';
    app.context.renderModeRules();
    assert.equal(app.elements.get('image-rule').hidden,false);
    assert.equal(app.elements.get('number-rule').hidden,true);
    app.elements.get('voteMode').value='number';
    app.context.renderModeRules();
    assert.equal(app.elements.get('image-rule').hidden,true);
    assert.equal(app.elements.get('number-rule').hidden,false);
});

test('delete all starts a new round and removes every archived ballot', async () => {
    const initial={items:[{name:'24_2301-2400',url:'x',votes:2}],round:4,maxVotes:1,headcount:5,numberBallots:{r0:{old:{n7:true}}},numberBallotsV2:{r4:{one:{n2358:1}}}};
    const app=setup([],initial);
    await app.context.deleteAllItems();
    assert.equal(app.server.data.items.length,0);
    assert.equal(app.server.data.round,5);
    assert.equal(app.server.data.headcount,0);
    assert.equal(app.server.data.numberBallotsV2,null);
    assert.equal(app.server.data.numberBallots,null);
    assert.equal(app.context.numberBallots && Object.keys(app.context.numberBallots()).length,0);
    assert.match(app.elements.get('save-status').textContent,/删除成功/);
});

test('delete all refuses to discard unsaved work or concurrent changes', async () => {
    const initial={items:[{name:'old',url:'x'}],round:0,maxVotes:1};
    const dirty=setup([],initial);
    dirty.context.markAdminDirty();
    await dirty.context.deleteAllItems();
    assert.equal(dirty.writes.length,0);
    assert.match(dirty.elements.get('save-status').textContent,/未保存/);
    const concurrent=setup([],initial);
    concurrent.server.data={items:[{name:'new',url:'x'}],round:0,maxVotes:1};
    await concurrent.context.deleteAllItems();
    assert.equal(concurrent.writes.length,0);
    assert.match(concurrent.elements.get('save-status').textContent,/数据已变化/);
});
