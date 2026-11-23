const fs=require('node:fs'),path=require('node:path');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
(async()=>{
 const rules=fs.readFileSync(path.join(__dirname,'database.rules.json'),'utf8');
 const env=await initializeTestEnvironment({projectId:'demo-spark',database:{host:'127.0.0.1',port:19473,rules}});
 try {
  await env.withSecurityRulesDisabled(c=>c.database().ref().set({sparkVote:{round:2,voteMode:'image'},sparkVoteAdmins:{owner:true}}));
  const guest=env.unauthenticatedContext().database(),a=env.authenticatedContext('a').database();
  const admin=env.authenticatedContext('owner',{firebase:{sign_in_provider:'google.com',identities:{}}}).database();
  await assertSucceeds(guest.ref('sparkVote').once('value'));
  await assertFails(guest.ref('sparkVote/maxVotes').set(8));
  await assertFails(a.ref('sparkVote/items').set([{name:'fixture'}]));
  await assertFails(a.ref('sparkVoteAdmins/a').set(true));
  const vote={_newParticipant:true,old_a_b:true};
  await assertSucceeds(a.ref('sparkVote/imageBallots/r2/a').set(vote));
  await assertFails(a.ref('sparkVote/imageBallots/r2/b').set(vote));
  await assertFails(a.ref('sparkVote/imageBallots/r1/a').set(vote));
  await assertSucceeds(admin.ref('sparkVote').update({voteMode:'number',maxVotes:5}));
  await assertSucceeds(a.ref('sparkVote/numberBallotsV2/r2/a').set({_format:2,n1:1}));
  await assertFails(a.ref('sparkVote/numberBallotsV2/r2/b').set({_format:2,n1:1}));
  await assertFails(a.ref('sparkVote/imageBallots/r2/a').set(vote));
  console.log('PASS: fixture public read, administrator configuration, own ballots, mode and round isolation');
 } finally {await env.cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1});
