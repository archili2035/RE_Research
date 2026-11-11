// Usage: node runtime/capture_to_csv.cjs capture.json [output.csv]
const fs = require('node:fs');
function convert(data) {
  if (data.schema !== 're9-3c-capture/1' || !Array.isArray(data.samples)) throw Error('Not a collector capture');
  const header = ['sample_index','unix_seconds','status','character_hint','updater_type','x','y','z','layer_index','layer_status','motion_bank','motion_id','motion_frame','end_frame','speed','weight'];
  const rows = [header];
  for (const s of data.samples) {
    for (const l of s.layers?.length ? s.layers : [{}]) {
      rows.push([s.sample_index,s.unix_seconds,s.status,s.character_hint,s.updater_type,
        s.position?.x,s.position?.y,s.position?.z,l.index,l.status,l.get_MotionBankID,l.get_MotionID,
        l.get_Frame,l.get_EndFrame,l.get_Speed,l.get_Weight]);
    }
  }
  return '\ufeff' + rows.map(row => row.map(v => v == null ? '' : '"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
}
module.exports = {convert};
if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input) throw Error('Usage: node runtime/capture_to_csv.cjs capture.json [output.csv]');
  const dest = output || input.replace(/\.json$/i,'') + '.csv';
  fs.writeFileSync(dest, convert(JSON.parse(fs.readFileSync(input,'utf8').replace(/^\ufeff/,''))), {flag:'wx'});
  console.log(dest);
}
