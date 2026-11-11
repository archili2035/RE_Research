const {convert} = require('../capture_to_csv.cjs');
const assert = require('node:assert/strict');
const text = convert({schema:'re9-3c-capture/1',samples:[
  {sample_index:1,status:'player_unavailable',layers:[]},
  {sample_index:2,layers:[{index:0,get_Frame:0}]},
]});
assert.equal(text.split('\r\n').length,4);
assert.ok(text.includes('"0"'));
assert.ok(text.includes('"player_unavailable"'));
assert.throws(()=>convert({}));
console.log('PASS: CSV preserves gaps and zero, rejects unknown schema');
