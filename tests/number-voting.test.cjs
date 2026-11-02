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
test('all sheets share 20 distinct choices; retry is idempotent and cancellation frees one place', () => {
    let ballot = {};
    for (let n=1;n<=20;n++) ballot=numbers.change(ballot,n,true);
    assert.equal(numbers.choices(ballot).length,20);
    assert.equal(numbers.change(ballot,2358,true),undefined);
    assert.deepEqual(numbers.change(ballot,20,true),ballot);
    const cancelled = numbers.change(ballot,7,false);
    assert.equal(numbers.choices(cancelled).length,19);
    const replacement = numbers.change(cancelled,2358,true);
    assert.equal(numbers.choices(replacement).length,20);
    assert.equal(replacement.n2358,true);
    assert.equal(ballot.n7,true,'transaction input must not mutate');
    assert.deepEqual(numbers.change(cancelled,7,false),cancelled);
    assert.deepEqual(numbers.change(null,1,false),{});
});
test('retry with a concurrent twentieth choice rejects the twenty-first', () => {
    const original = Object.fromEntries(Array.from({length:19},(_,i)=>[`n${i+1}`,true]));
    assert.ok(numbers.change(original,2358,true));
    const latest = numbers.change(original,20,true);
    assert.equal(numbers.change(latest,2358,true),undefined);
});
test('rankings count distinct voter ballots and exclude empty selections', () => {
    const result = numbers.summarize({one:{n2358:true,n2301:true},two:{n2358:true},cancelled:{},invalid:{n0:true,n9999999:true,n7:false}});
    assert.equal(result.participants,2);
    assert.equal(result.total,3);
    assert.deepEqual(result.ranking,[{number:2358,votes:2},{number:2301,votes:1}]);
});
