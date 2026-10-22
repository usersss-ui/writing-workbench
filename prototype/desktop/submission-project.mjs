import { adoptScenario, createProjectSession, exportProject, createLatestBackupReader, appendOutline, exportWriting } from './submission-project-model.mjs';
import { createProjectView } from './submission-project-ui.mjs';

export async function initializeSubmissionProject({document=globalThis.document,window=globalThis.window,fetchImpl=globalThis.fetch}={}) {
  const byId=id=>document.getElementById(id);
  const error=message=>{byId('project-error').textContent=message;byId('project-error').hidden=!message;};
  const download=(filename,text,type)=>{
    const url=window.URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();window.setTimeout(()=>window.URL.revokeObjectURL(url),1000);
  };
  async function request(url,options={}) {
    const response=await fetchImpl(url,{cache:'no-store',credentials:'same-origin',...options});
    if(!response.ok){
      const failure=await response.json().catch(()=>null);
      if(failure?.error?.code==='LIBRARY_WRITE_BUSY')throw new Error('工作台正在保存其他内容，请稍后重试。本页编辑内容已保留。');
      if(failure?.error?.code==='SUBMISSION_STATE_CORRUPT')throw new Error('本机保存文件无法读取，已停止保存以保留原文件。请使用项目 JSON 备份检查恢复。');
      if(response.status===409)throw new Error('磁盘已有新版本，本页内容已保留。请先导出完整项目 JSON，然后重新打开本页读取最新版本，再核对或恢复备份。');
      if(response.status===404)throw new Error('本机投稿项目尚未接入，或材料文件不存在。请从已启动的本机工作台打开本页。');
      throw new Error(`请求未成功（${response.status}）。当前编辑内容已保留，可先导出备份后重试。`);
    }
    return response.json();
  }
  try {
    const {project,state}=await request('/api/v1/submission-project');
    const session=createProjectSession(project,state,body=>request('/api/v1/submission-project/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
    const view=createProjectView(document);
    let previewId=state.scenarioId||[...project.scenarios].sort((a,b)=>a.priority-b.priority)[0].id;
    let pendingImport=null;
    const backupReader=createLatestBackupReader();
    function status(message) {byId('save-status').textContent=message|| (session.dirty?'有未保存的更改':`已读取本机版本 ${session.state.revision}`);byId('save-project').disabled=session.saving||!session.dirty;view.renderProgress(project,session.state);}
    function update(transform) {try{session.update(transform);error('');status();}catch(cause){error(cause.message);}}
    const callbacks={
      preview(id){previewId=id;renderRoute();},
      adopt(id){update(s=>adoptScenario(project,s,id));renderRoute();},
      journal(id){update(s=>({...s,journalId:id}));renderRoute();},
      experiment(id,record){update(s=>({...s,experiments:{...s.experiments,[id]:record}}));}
    };
    function renderRoute(){view.renderRoute(project,session.state,previewId,callbacks);view.renderProgress(project,session.state);}
    function renderEditor(){byId('project-notes').value=session.state.notes;byId('project-draft').value=session.state.draft;}
    view.renderMaterials(project);renderRoute();renderEditor();status();byId('project-content').hidden=false;
    for(const [id,field]of [['project-notes','notes'],['project-draft','draft']])byId(id).addEventListener('input',()=>update(s=>({...s,[field]:byId(id).value})));
    byId('save-project').addEventListener('click',async()=>{
      error('');try{const pending=session.save();status('正在保存到本机…');await pending;status(session.dirty?'已保存提交版本；后续输入尚未保存':`已保存到本机 · 版本 ${session.state.revision}`);}catch(cause){error(cause.message);status('保存未完成，编辑内容已保留');}
    });
    byId('append-outline').addEventListener('click',()=>{update(s=>({...s,draft:appendOutline(project,s)}));byId('project-draft').value=session.state.draft;byId('project-draft').focus();});
    byId('export-writing').addEventListener('click',()=>download(`${project.id}-writing.md`,exportWriting(project,session.state),'text/markdown;charset=utf-8'));
    byId('export-project').addEventListener('click',()=>download(`${project.id}-project.json`,exportProject(project,session.state),'application/json'));
    byId('import-project').addEventListener('click',()=>byId('project-file').click());
    byId('project-file').addEventListener('change',async()=>{
      const file=byId('project-file').files?.[0];if(!file)return;
      pendingImport=null;byId('import-preview').hidden=true;byId('project-file').value='';
      try{const restored=await backupReader.read(project,session.state,file);if(!restored)return;
        pendingImport=restored;byId('import-summary').textContent=`正文 ${restored.draft.length} 字符；备注 ${restored.notes.length} 字符；实验记录 ${Object.keys(restored.experiments).length} 条。采用路线：${project.scenarios.find(s=>s.id===restored.scenarioId)?.title||'待选'}。`;
        byId('import-preview').hidden=false;error('');
      }catch(cause){pendingImport=null;byId('import-preview').hidden=true;error(cause.message);}
    });
    byId('cancel-import').addEventListener('click',()=>{backupReader.cancel();pendingImport=null;byId('import-preview').hidden=true;});
    byId('apply-import').addEventListener('click',()=>{
      if(!pendingImport)return;
      update(s=>({...pendingImport,revision:s.revision}));pendingImport=null;byId('import-preview').hidden=true;
      previewId=session.state.scenarioId||previewId;renderRoute();renderEditor();status(session.dirty?'备份已载入编辑区，尚未保存到本机':'备份已载入，与本机已保存内容相同');
    });
    window.addEventListener('beforeunload',event=>{if(session.dirty||session.saving){event.preventDefault();event.returnValue='';}});
    if(window.location.hash)byId(window.location.hash.slice(1))?.scrollIntoView();
    return {project,session};
  } catch(cause) {
    error(cause.message||'无法读取项目。请确认本机工作台服务已启动。');byId('save-status').textContent='项目未载入';byId('save-project').disabled=true;return null;
  }
}

if(typeof document!=='undefined')initializeSubmissionProject();
