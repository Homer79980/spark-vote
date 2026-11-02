const {test} = require('node:test');
const assert = require('node:assert/strict');
const numbers = require('../number-voting.js');
const items = [{name:'01_1-100',group:'A'},{name:'24_2301-2400.png',group:'B'}];

test('filename ranges identify the first and last candidates, independent of group', () => {
    assert.deepEqual(numbers.range('24_2301-2400.png'),{start:2301,end:2400});
    assert.equal(numbers.find(items,2301).index,1);
    assert.equal(numbers.find(items,2400).index,1);
    assert.equal(numbers.find(items,'２３５８').number,2358);
    for (const input of ['', '1e2', '23.5', '-1', '0', '2401', '101', '<script>']) assert.ok(numbers.find(items,input).error,input);
    for (const name of ['普通图片','24_2400-2301','0-100','1-999999','test-1']) assert.equal(numbers.range(name),null,name);
});
test('overlapping images cannot silently receive the wrong vote', () => {
    const duplicate = [...items,{name:'重复_2350-2450'}];
    assert.match(numbers.overlap(duplicate),/重叠/);
    assert.match(numbers.find(duplicate,2358).error,/多张/);
    assert.equal(numbers.overlap(items),'');
});
test('repeated numbers consume a shared 50-vote budget and cancellation restores one vote', () => {
    let ballot = {};
    for (let n=1;n<=50;n++) ballot=numbers.applyVotes(ballot,[2358]);
    assert.equal(numbers.totalVotes(ballot),50);
    assert.deepEqual(numbers.choices(ballot),[2358]);
    assert.equal(ballot.n2358,50);
    assert.equal(numbers.applyVotes(ballot,[2358]),undefined);
    assert.equal(numbers.applyVotes(ballot,[1]),undefined);
    const cancelled = numbers.applyVotes(ballot,[2358],false);
    assert.equal(cancelled.n2358,49);
    assert.equal(ballot.n2358,50,'transaction input must not mutate');
    const replacement = numbers.applyVotes(cancelled,[1]);
    assert.equal(numbers.totalVotes(replacement),50);
    assert.equal(replacement.n1,1);
});
test('comma, Chinese comma, enumeration comma and full-width digits split into votes', () => {
    assert.deepEqual(numbers.parseBatch(' １,２，2358、1\n2 ').numbers,[1,2,2358,1,2]);
    assert.ok(numbers.parseBatch('1,2.5').error);
    assert.ok(numbers.parseBatch('').error);
    assert.ok(numbers.parseBatch(Array(51).fill(1).join(',')).error);
    assert.ok(numbers.findBatch(items,'1,2401').error,'one invalid number rejects the entire batch');
    assert.deepEqual(numbers.findBatch(items,'1,2358、1').numbers,[1,2358,1]);
    assert.deepEqual(numbers.applyVotes({},[1,2358,1]),{_format:2,n1:2,n2358:1});
});
test('atomic batches and transaction retries cannot overspend the fiftieth vote', () => {
    const original = {n1:48};
    assert.equal(numbers.applyVotes(original,[1,2,3]),undefined);
    assert.deepEqual(original,{n1:48});
    const next=numbers.applyVotes(original,[1,2358]);
    assert.deepEqual(next,numbers.applyVotes(original,[1,2358]),'retry callback with the same snapshot remains pure');
    assert.equal(numbers.totalVotes(next),50);
    assert.equal(numbers.applyVotes(next,[1]),undefined);
});
test('legacy boolean votes count as one and rankings sum repeated votes', () => {
    const result = numbers.summarize({one:{n2358:3,n2301:true},two:{n2358:true},cancelled:{_format:2},invalid:{n0:true,n9999999:true,n7:false,n8:-2,n9:1.5}});
    assert.equal(result.participants,2);
    assert.equal(result.total,5);
    assert.deepEqual(result.ranking,[{number:2358,votes:4},{number:2301,votes:1}]);
    assert.equal(numbers.applyVotes({n2358:true},[2358]).n2358,2);
});
test('new ballots override legacy ballots once and empty migrated ballots never resurrect votes', () => {
    const data={numberBallots:{r0:{one:{n2358:true},two:{n1:true}}}};
    const migrated=numbers.applyVotes(data.numberBallots.r0.one,[2358]);
    data.numberBallotsV2={r0:{one:migrated}};
    assert.equal(numbers.summarize(numbers.effectiveBallots(data,'r0')).total,3);
    data.numberBallotsV2.r0.one=numbers.applyVotes(numbers.applyVotes(migrated,[2358],false),[2358],false);
    assert.deepEqual(data.numberBallotsV2.r0.one,{_format:2});
    assert.equal(numbers.summarize(numbers.effectiveBallots(data,'r0')).total,1);
    assert.equal(data.numberBallots.r0.one.n2358,true,'legacy data must remain untouched');
    assert.equal(numbers.summarize(numbers.effectiveBallots(data,'r1')).total,0);
});
