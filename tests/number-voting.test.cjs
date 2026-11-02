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
test('one browser gets one vote per number and 500 distinct numbers in total', () => {
    let ballot = numbers.applyVotes({},[2358,2358,2358]);
    assert.equal(numbers.totalVotes(ballot),1);
    assert.equal(ballot.n2358,1);
    for (let n=1;n<=499;n++) ballot=numbers.applyVotes(ballot,[n]);
    assert.equal(numbers.totalVotes(ballot),500);
    assert.equal(numbers.applyVotes(ballot,[2358]).n2358,1);
    assert.equal(numbers.applyVotes(ballot,[500]),undefined);
    const cancelled = numbers.applyVotes(ballot,[2358],false);
    assert.equal(numbers.totalVotes(cancelled),499);
    assert.equal(ballot.n2358,1,'transaction input remains unchanged');
    assert.equal(numbers.totalVotes(numbers.applyVotes(cancelled,[500])),500);
});
test('batch input deduplicates comma, Chinese comma, enumeration comma and full-width digits', () => {
    assert.deepEqual(numbers.parseBatch(' １,２，2358、1\n2 ').numbers,[1,2,2358]);
    assert.deepEqual(numbers.parseBatch(Array(51).fill(1).join(',')).numbers,[1]);
    assert.ok(numbers.parseBatch('1,2.5').error);
    assert.ok(numbers.parseBatch('').error);
    assert.ok(numbers.findBatch(items,'1,2401').error);
    assert.deepEqual(numbers.findBatch(items,'1,2358、1').numbers,[1,2358]);
    assert.deepEqual(numbers.applyVotes({},[1,2358,1]),{_format:2,n1:1,n2358:1});
});
test('atomic batches and retries enforce the 500 distinct number limit', () => {
    const original = Object.fromEntries(Array.from({length:499},(_,index)=>[`n${index+1}`,1]));
    assert.equal(numbers.applyVotes(original,[1,500,501]),undefined);
    const next=numbers.applyVotes(original,[1,500,500]);
    assert.deepEqual(next,numbers.applyVotes(original,[1,500,500]));
    assert.equal(numbers.totalVotes(next),500);
    assert.equal(numbers.applyVotes(next,[501]),undefined);
    assert.equal(numbers.applyVotes(next,[1]).n1,1);
});
test('old repeated counts remain stored but count as one per browser in rankings', () => {
    const old = {n2358:3,n2301:true};
    const result = numbers.summarize({one:old,two:{n2358:true},cancelled:{_format:2},invalid:{n0:true,n9999999:true,n7:false,n8:-2,n9:1.5}});
    assert.equal(result.participants,2);
    assert.equal(result.total,3);
    assert.deepEqual(result.ranking,[{number:2358,votes:2},{number:2301,votes:1}]);
    assert.equal(numbers.applyVotes(old,[2358]).n2358,3,'existing stored counts remain untouched');
    assert.equal(numbers.applyVotes(old,[2358],false).n2358,undefined);
    assert.equal(old.n2358,3,'old input remains untouched');
});
test('new ballots override legacy ballots and cancellation never resurrects votes', () => {
    const data={numberBallots:{r0:{one:{n2358:true},two:{n1:true}}}};
    const migrated=numbers.applyVotes(data.numberBallots.r0.one,[2358]);
    data.numberBallotsV2={r0:{one:migrated}};
    assert.equal(numbers.summarize(numbers.effectiveBallots(data,'r0')).total,2);
    data.numberBallotsV2.r0.one=numbers.applyVotes(migrated,[2358],false);
    assert.deepEqual(data.numberBallotsV2.r0.one,{_format:2});
    assert.equal(numbers.summarize(numbers.effectiveBallots(data,'r0')).total,1);
    assert.equal(data.numberBallots.r0.one.n2358,true);
    assert.equal(numbers.summarize(numbers.effectiveBallots(data,'r1')).total,0);
});
