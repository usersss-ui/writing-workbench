const fail = message => { throw new Error(message); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => isObject(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
export const STATUS_LABELS = {planned:'待开展', running:'进行中', done:'已完成（用户记录）'};

export function validateState(project, state, {allowIncompleteEvidence=false}={}) {
  if (!exact(state,['version','projectId','revision','scenarioId','journalId','experiments','notes','draft']) || state.version !== 1 || state.projectId !== project.id || !Number.isSafeInteger(state.revision) || state.revision < 0) fail('项目状态格式不正确，未修改已保存内容。');
  const scenario = project.scenarios.find(item => item.id === state.scenarioId);
  if (state.scenarioId !== null && !scenario) fail('应用场景不属于当前项目。');
  if (state.journalId !== null && (!scenario?.journalIds.includes(state.journalId) || !project.journals.some(item => item.id === state.journalId))) fail('候选期刊与应用场景不匹配。');
  if (!isObject(state.experiments)) fail('实验记录格式不正确。');
  for (const [id, record] of Object.entries(state.experiments)) {
    if (!project.experiments.some(item => item.id === id) || !exact(record,['status','evidence']) || typeof record.status !== 'string' || !Object.hasOwn(STATUS_LABELS,record.status) || typeof record.evidence !== 'string' || record.evidence.length > 10000) fail('实验状态或证据格式不正确。');
    if (!allowIncompleteEvidence && record.status === 'done' && !record.evidence.trim()) fail('标记实验完成前，请填写结果文件或证据说明。');
  }
  if (typeof state.notes !== 'string' || state.notes.length > 20000 || typeof state.draft !== 'string' || state.draft.length > 200000) fail('决策备注或正文超过长度限制。');
  return state;
}

export function adoptScenario(project, state, scenarioId) {
  const scenario = project.scenarios.find(item => item.id === scenarioId);
  if (!scenario) fail('请选择当前项目中的应用场景。');
  return {...structuredClone(state), scenarioId, journalId:scenario.journalIds.includes(state.journalId) ? state.journalId : null};
}

export function exportProject(project,state) {
  // Export even an incomplete editor: this is the recovery path after a save error.
  return JSON.stringify({schema:'research-submission-backup',version:1,exportedAt:new Date().toISOString(),project:structuredClone(project),state:structuredClone(state)},null,2);
}

export function restoreProject(project,currentState,text) {
  if (typeof text !== 'string' || text.length > 2000000) fail('请使用小于 2 MB 的项目 JSON 备份。');
  let backup;
  try { backup=JSON.parse(text); } catch { fail('无法解析项目 JSON，当前编辑内容已保留。'); }
  if (!exact(backup,['schema','version','exportedAt','project','state']) || backup.schema !== 'research-submission-backup' || backup.version !== 1 || backup.project?.id !== project.id || backup.project?.version !== project.version || !isObject(backup.state)) fail('这不是当前论文项目的有效备份。');
  const canonical=value=>Array.isArray(value)?value.map(canonical):isObject(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  if (JSON.stringify(canonical(backup.project))!==JSON.stringify(canonical(project))) fail('备份中的研究材料版本与当前项目不同。请先从备份提取正文和证据手动核对；当前编辑内容已保留。');
  const restored={...backup.state,revision:currentState.revision};
  validateState(project,restored,{allowIncompleteEvidence:true});
  return structuredClone(restored);
}

export function createLatestBackupReader() {
  let generation=0;
  return {
    cancel(){generation++;},
    async read(project,state,file){
      const current=++generation;
      try {
        if(file.size>2000000)fail('项目 JSON 文件需小于 2 MB。');
        const text=await file.text();
        if(current!==generation)return null;
        return restoreProject(project,state,text);
      } catch(error) {if(current!==generation)return null;throw error;}
    }
  };
}

export function appendOutline(project,state) {
  const scenario=project.scenarios.find(item=>item.id===state.scenarioId);
  if (!scenario) fail('先采用一个应用场景，再生成对应提纲。');
  const marker=`<!-- submission-outline:${project.id}:${scenario.id} -->`;
  if (state.draft.includes(marker)) return state.draft;
  const journal=project.journals.find(item=>item.id===state.journalId);
  return [state.draft.trimEnd(),marker,`# ${scenario.writingTitle || scenario.title}`,`> 写作提纲：所有实验结果、数值与优势结论均待补充验证。候选期刊：${journal?.name || '待选择'}。`,
    ...project.outline.map(section=>`## ${section.title}\n\n${section.purpose}\n\n材料依据：${project.documents.find(item=>item.id===section.source)?.title || section.source}\n\n[待补：在此写入正文与实际证据]`)].filter(Boolean).join('\n\n');
}

export function createProjectSession(project,initialState,persist) {
  validateState(project,initialState);
  let current=structuredClone(initialState), baseline=structuredClone(initialState), saving=false;
  return {
    get state(){return structuredClone(current);},
    get dirty(){return JSON.stringify(current)!==JSON.stringify(baseline);},
    get saving(){return saving;},
    update(transform){
      const next=transform(structuredClone(current));
      validateState(project,next,{allowIncompleteEvidence:true});
      current=structuredClone(next);
    },
    async save(){
      if (saving) fail('正在保存，请稍候。');
      validateState(project,current);
      saving=true;
      const submitted=structuredClone(current);
      try {
        const result=await persist({expectedRevision:baseline.revision,state:submitted});
        validateState(project,result.state);
        if (result.state.revision <= baseline.revision) fail('服务端未确认新版本，编辑内容已保留。');
        baseline=structuredClone(result.state);
        if (JSON.stringify(current)===JSON.stringify(submitted)) current=structuredClone(result.state);
        else current={...current,revision:result.state.revision};
        return structuredClone(result.state);
      } finally { saving=false; }
    }
  };
}

export function exportWriting(project,state) {
  const scenario=project.scenarios.find(item=>item.id===state.scenarioId);
  const journal=project.journals.find(item=>item.id===state.journalId);
  const datasets=project.datasets.filter(item=>scenario?.datasetIds.includes(item.id));
  const experiments=project.experiments.filter(item=>!scenario || item.scenarioIds.includes(scenario.id));
  return [`# ${project.title} · 写作材料与草稿`, `研究材料日期：${project.updatedAt}。导出包含当前编辑内容，未保存内容也会保留。`,
    `应用场景：${scenario?.title || '待选择'}\n\n候选期刊：${journal?.name || '待选择'}`,
    '## 数据与实验依据',...datasets.map(item=>`- [${item.name}](${item.url})`),
    ...experiments.map(item=>{const r=state.experiments[item.id]||{status:'planned',evidence:''};const status=r.status==='done'&&!r.evidence.trim()?'待补证据（尚未确认完成）':STATUS_LABELS[r.status]||'未识别';return `### ${item.title}\n\n${item.purpose}\n\n比较：${item.comparison}\n\n状态：${status}\n\n证据（用户记录，未自动核验）：${r.evidence || '待补'}`;}),
    '## 决策备注',state.notes || '待补', '## 正文草稿',state.draft || '待补', '## 排版提示', journal?.formatNote || '期刊尚未选择；选定后核对官方投稿指南。',
    '## 项目资料入口',...project.documents.map(item=>`- ${item.title}（工作台材料 ID：${item.id}）`)].join('\n\n')+'\n';
}
