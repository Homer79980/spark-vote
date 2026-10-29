// Test-only Firebase replacement. Loaded exclusively by the local fixture server.
(() => {
    const key = 'spark-vote-browser-test';
    let server = JSON.parse(localStorage.getItem(key) || 'null') || {items:[],headcount:0,maxVotes:1,round:0};
    let rejectNext = false, connected = true;
    const listeners = {};
    const snapshot = value => ({val:()=>structuredClone(value)});
    const publish = () => {localStorage.setItem(key,JSON.stringify(server)); listeners.sparkVote?.(snapshot(server));};
    window.firebase = {initializeApp(){},database:()=>({ref(path){return {
        on(event,fn){listeners[path]=fn;queueMicrotask(()=>fn(snapshot(path === '.info/connected' ? connected : server)));},
        async transaction(update){
            if (rejectNext) {rejectNext=false;throw new Error('PERMISSION_DENIED (test)');}
            if(path === 'sparkVote') {
                const next=update(structuredClone(server));
                if(next===undefined) return {committed:false,snapshot:snapshot(server)};
                server=next;publish();return {committed:true,snapshot:snapshot(server)};
            }
            if(path.endsWith('/votes')){const index=Number(path.split('/')[2]);server.items[index].votes=update(server.items[index].votes);}
            else if(path.endsWith('/headcount'))server.headcount=update(server.headcount);
            publish();return {committed:true,snapshot:snapshot(server)};
        },
        async update(payload){Object.assign(server,payload);publish();},
        async set(){throw new Error('Destructive operations are disabled in this test fixture');}
    };}})};
    document.addEventListener('DOMContentLoaded',()=>{
        const panel=document.createElement('div'); panel.id='test-controls';
        panel.style='padding:10px;background:#fff3cd;position:relative;z-index:10002;display:flex;gap:8px;flex-wrap:wrap';
        for(const [label,action] of [
            ['模拟实时票数更新',()=>{if(server.items[0])server.items[0].votes=(server.items[0].votes||0)+1;server.headcount++;publish();}],
            ['模拟下次保存失败',()=>{rejectNext=true;}],
            ['切换网络状态',()=>{connected=!connected;listeners['.info/connected']?.(snapshot(connected));}]
        ]){const button=document.createElement('button');button.textContent=label;button.onclick=action;panel.appendChild(button);}
        document.body.prepend(panel);
    });
})();
