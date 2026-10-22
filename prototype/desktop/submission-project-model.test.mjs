import test from 'node:test';
import assert from 'node:assert/strict';
import { adoptScenario, validateState, exportProject, restoreProject, appendOutline, exportWriting, createProjectSession, createLatestBackupReader } from './submission-project-model.mjs';

const project = { id:'paper-1', version:1, updatedAt:'2026-09-09', title:'在线优化应用论文', summary:'待补实验', recommendation:'先研究楼宇',
  scenarios:[{id:'buildings',title:'楼宇',journalIds:['energy'],datasetIds:['bdg'],advantages:['待验证通信成本'],writingTitle:'楼宇在线校准'}, {id:'sensors',title:'传感器',journalIds:['sensors-j'],datasetIds:[],advantages:[]}],
  journals:[{id:'energy',name:'Energy',formatNote:'使用官方模板'},{id:'sensors-j',name:'Sensors'}], datasets:[{id:'bdg',name:'BDG2',url:'https://example.org/data'}],
  experiments:[{id:'privacy',title:'隐私预算实验',purpose:'比较预算',comparison:'无隐私基线',metrics:['MAE'],scenarioIds:['buildings','sensors']}],
  outline:[{title:'引言',purpose:'解释实际问题',source:'研究建议'}], documents:[{id:'r1',title:'报告',url:'/api/v1/submission-project/documents/r1'}] };
const state = {version:1,projectId:'paper-1',revision:4,scenarioId:'buildings',journalId:'energy',experiments:{privacy:{status:'running',evidence:'已准备数据'}},notes:'保留决策',draft:'我的既有正文'};

test('changing route removes incompatible journal but retains experiments, notes and manuscript',()=>{
  const next=adoptScenario(project,state,'sensors');
  assert.equal(next.journalId,null); assert.equal(next.draft,'我的既有正文');
  assert.deepEqual(next.experiments,{privacy:{status:'running',evidence:'已准备数据'}});
  assert.equal(state.scenarioId,'buildings'); assert.throws(()=>adoptScenario(project,state,'unknown'));
});
test('completed experiments need evidence and incompatible journal selection cannot be saved',()=>{
  assert.doesNotThrow(()=>validateState(project,state));
  assert.throws(()=>validateState(project,{...state,experiments:{privacy:{status:'done',evidence:'  '}}}));
  assert.throws(()=>validateState(project,{...state,scenarioId:'sensors'}));
  assert.throws(()=>validateState(project,{...state,experiments:{ghost:{status:'planned',evidence:''}}}));
  assert.throws(()=>validateState(project,{...state,experiments:{privacy:{status:['done'],evidence:''}}}));
  assert.throws(()=>validateState(project,{...state,unknown:'hidden'}));
});
test('project backup recovers unsaved evidence and manuscript while retaining current conflict revision',()=>{
  const backup=exportProject(project,{...state,draft:'尚未保存的正文',experiments:{privacy:{status:'done',evidence:'results/run-1.csv'}}});
  const parsed=JSON.parse(backup); assert.equal(parsed.project.documents[0].title,'报告');
  const recovered=restoreProject(project,{...state,revision:9},backup);
  assert.equal(recovered.revision,9); assert.equal(recovered.draft,'尚未保存的正文');
  assert.equal(recovered.experiments.privacy.evidence,'results/run-1.csv');
  parsed.project.id='another-paper'; assert.throws(()=>restoreProject(project,state,JSON.stringify(parsed)));
  const changed=JSON.parse(backup);changed.project.experiments[0].comparison='不同的实验比较';
  assert.throws(()=>restoreProject(project,state,JSON.stringify(changed)),/材料版本/);
  assert.throws(()=>restoreProject(project,state,'broken JSON'));
});
test('outline appends to manuscript once, requires route, and labels evidence as pending',()=>{
  const once=appendOutline(project,state);
  assert.ok(once.startsWith('我的既有正文'));
  assert.match(once,/楼宇在线校准/); assert.match(once,/待补/);
  assert.equal(appendOutline(project,{...state,draft:once}),once);
  assert.throws(()=>appendOutline(project,{...state,scenarioId:null,journalId:null}));
});
test('writing export includes actual user evidence and selected route without claiming verification',()=>{
  const md=exportWriting(project,{...state,experiments:{privacy:{status:'done',evidence:'results/run-1.csv'}}});
  assert.match(md,/我的既有正文/); assert.match(md,/results\/run-1.csv/);
  assert.match(md,/用户记录/); assert.match(md,/Energy/); assert.match(md,/BDG2/);
});
test('typing during a save remains unsaved and the next save uses the new disk revision',async()=>{
  let complete; const requests=[];
  const session=createProjectSession(project,state,body=>{requests.push(body);return new Promise(resolve=>{complete=resolve;});});
  session.update(s=>({...s,draft:'提交时正文'})); const pending=session.save();
  session.update(s=>({...s,draft:'保存期间继续输入'}));
  complete({state:{...requests[0].state,revision:5}}); await pending;
  assert.equal(session.state.draft,'保存期间继续输入'); assert.equal(session.dirty,true);
  const second=session.save(); assert.equal(requests[1].expectedRevision,5);
  complete({state:{...requests[1].state,revision:6}}); await second; assert.equal(session.dirty,false);
});
test('conflict or server failure keeps the entire editor and its stale revision for explicit recovery',async()=>{
  const session=createProjectSession(project,state,async()=>{throw new Error('409 conflict');});
  session.update(s=>({...s,notes:'本地决策',draft:'本地正文'}));
  await assert.rejects(()=>session.save(),/409/);
  assert.equal(session.state.revision,4); assert.equal(session.state.draft,'本地正文');
  assert.equal(session.dirty,true); assert.equal(session.saving,false);
});
test('a backup can restore an incomplete experiment editor after a rejected save',()=>{
  const unfinished={...state,experiments:{privacy:{status:'done',evidence:''}}};
  const backup=exportProject(project,unfinished);
  assert.equal(restoreProject(project,state,backup).experiments.privacy.status,'done');
  assert.throws(()=>validateState(project,restoreProject(project,state,backup)));
  const md=exportWriting(project,unfinished);
  assert.doesNotMatch(md,/状态：已完成/);assert.match(md,/尚未确认完成/);
});
test('a slow prior backup cannot replace a newer selection or show its late parse error',async()=>{
  const reader=createLatestBackupReader();let finish;
  const slow={size:100,text:()=>new Promise(resolve=>{finish=resolve;})};
  const first=reader.read(project,state,slow);
  const latest=await reader.read(project,state,{size:100,text:async()=>exportProject(project,{...state,draft:'新选择的备份'})});
  assert.equal(latest.draft,'新选择的备份');finish('invalid old JSON');assert.equal(await first,null);
});
