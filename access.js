(function(root) {
    function open(sdk,config) {
        if(!config?.apiKey || config.projectId!=='playa-dc7ae') throw Error('Firebase 登录尚未配置');
        const userApp=sdk.initializeApp(config);
        const adminApp=sdk.initializeApp(config,'spark-management');
        const auth=userApp.auth(), adminAuth=adminApp.auth();
        let pending;
        const ready=new Promise((resolve,reject)=>{
            const off=auth.onAuthStateChanged(user=>{off();resolve(user);},reject);
        });
        async function voter() {
            await ready;
            if(auth.currentUser) return auth.currentUser.uid;
            if(!pending) pending=auth.signInAnonymously().then(r=>r.user.uid).finally(()=>{pending=null;});
            return pending;
        }
        async function login() {
            const provider=new sdk.auth.GoogleAuthProvider();
            provider.setCustomParameters({prompt:'select_account'});
            const {user}=await adminAuth.signInWithPopup(provider);
            try {
                const role=await adminApp.database().ref('sparkVoteAdmins/'+user.uid).once('value');
                if(role.val()!==true) throw Error('此账号没有投票管理权限');
            } catch(e) { await adminAuth.signOut();throw e; }
        }
        return {db:userApp.database(),adminDb:adminApp.database(),voter,uid:()=>auth.currentUser?.uid||'',
                login,logout:()=>adminAuth.signOut()};
    }
    root.SparkAccess={open};
})(globalThis);
