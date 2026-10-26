'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {identityScanner,readInput,MAX_INPUT_BYTES}=require('../scripts/input.cjs');

test('streaming identity ignores nested or escaped source claims across arbitrary chunk boundaries',()=>{
  const input=JSON.stringify({tool_response:{cwd:'/wrong',session_id:'wrong',output:'\\"},"cwd":"also-wrong"'},cwd:'/actual/한글',session_id:'native',hook_event_name:'PostToolUse',tool_use_id:'native-tool'});
  const scan=identityScanner();
  for(const char of input)scan.feed(char);
  assert.deepEqual(scan.fields,{cwd:'/actual/한글',session_id:'native',hook_event_name:'PostToolUse',tool_use_id:'native-tool'});
});

test('oversized stream retains bounded top-level metadata after discarding body and counts UTF-8 bytes',async()=>{
  const input=JSON.stringify({tool_response:'가'.repeat(MAX_INPUT_BYTES/3+1),session_id:'native',cwd:'/actual',hook_event_name:'Stop'});
  const bytes=Buffer.from(input);
  const result=await readInput(Readable.from([bytes.subarray(0,101),bytes.subarray(101,4000),bytes.subarray(4000)]));
  assert.equal(result.oversized,true);assert.equal(result.input,'');assert.equal(result.inputBytes,bytes.length);
  assert.deepEqual(result.metadata,{session_id:'native',cwd:'/actual',hook_event_name:'Stop'});
});
