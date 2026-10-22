import { STATUS_LABELS } from './submission-project-model.mjs';

export function createProjectView(document) {
  const byId=id=>document.getElementById(id);
  const node=(tag,text='',className='')=>{const e=document.createElement(tag);e.textContent=text;if(className)e.className=className;return e;};
  const list=items=>{const ul=node('ul'); for(const item of items)ul.append(node('li',item)); return ul;};
  const link=(text,url)=>{
    const a=node('a',text);
    if (typeof url==='string' && (/^https:\/\//.test(url) || /^\/api\/v1\/submission-project\/documents\/[a-zA-Z0-9_-]+$/.test(url))) {
      a.href=url;a.target='_blank';a.rel='noopener noreferrer';
    }
    return a;
  };
  const button=(text,callback,className='button button--secondary')=>{const b=node('button',text,className);b.type='button';b.addEventListener('click',callback);return b;};
  const docLink=(project,id,label='查看依据 →')=>{const doc=project.documents.find(item=>item.id===id);return doc?link(label,doc.url):node('span','来源暂不可用');};
  return {
    renderMaterials(project) {
      byId('project-title').textContent=project.title;
      byId('project-summary').textContent=`调研时的状态：${project.summary}`;
      byId('project-status').textContent=project.statusLabel;
      byId('materials-date').textContent=` · 材料核验 ${project.updatedAt}`;
      byId('project-recommendation').textContent=project.recommendation;
      byId('algorithm-list').replaceChildren(...project.algorithmFacts.map(fact=>{
        const details=node('details'),summary=node('summary');
        summary.append(node('span',fact.status==='gap'?'实现缺口':'已核验边界','submission-badge'),node('span',fact.title));
        details.append(summary,node('p',fact.finding),docLink(project,fact.sourceDocumentId));return details;
      }));
      byId('document-list').replaceChildren(...project.documents.map(doc=>{
        const a=link('',doc.url);a.className='document-link';a.append(node('strong',`${doc.kind==='pdf'?'PDF':doc.kind==='source'?'理论稿':'研究报告'} · ${doc.title}`),node('small',doc.description));return a;
      }));
    },
    renderRoute(project,state,previewId,callbacks) {
      const scenario=project.scenarios.find(item=>item.id===previewId);
      if(!scenario)return;
      const adopted=state.scenarioId===scenario.id;
      byId('scenario-tabs').replaceChildren(...project.scenarios.map(item=>{
        const b=button('',()=>callbacks.preview(item.id),'scenario-tab');
        b.setAttribute('aria-pressed',String(item.id===previewId));
        b.append(node('span',item.id===state.scenarioId?'已采用':item.priority===1?'推荐起点':`备选 ${item.priority-1}`),node('strong',item.title));return b;
      }));
      const detail=byId('scenario-detail');
      const columns=node('div','','scenario-columns');
      const advantages=node('div');advantages.append(node('h3','在哪些方面验证优势'),list(scenario.advantages));
      const requirements=node('div');requirements.append(node('h3','应用成立的条件'),list(scenario.requirements));columns.append(advantages,requirements);
      const next=node('div','','scenario-next');next.append(node('p',`下一步：${scenario.nextStep}`));
      const choose=button(adopted?'当前已采用这条路线':'采用这条路线',()=>callbacks.adopt(scenario.id),'button button--primary');choose.disabled=adopted;next.append(choose);
      detail.replaceChildren(node('h3',scenario.title),node('p',scenario.summary),node('p',`优化变量：${scenario.decisionVariable}`),columns,node('p',`评价指标：${scenario.metrics.join(' · ')}`),next);
      byId('dataset-list').replaceChildren(...project.datasets.filter(item=>scenario.datasetIds.includes(item.id)).map(item=>{
        const card=node('article','','submission-card'),links=node('div','','submission-links');links.append(link('打开官方数据来源 ↗',item.url));
        card.append(node('h3',item.name),node('p',item.description),list(item.caveats),links);return card;
      }));
      byId('experiment-route').textContent=`${adopted?'当前路线':'场景预览'} · ${scenario.title}`;
      byId('experiment-list').replaceChildren(...project.experiments.filter(item=>item.scenarioIds.includes(scenario.id)).map(item=>{
        const record=state.experiments[item.id]||{status:'planned',evidence:''};
        const card=node('article','','experiment-card');const info=node('div');
        info.append(node('h3',item.title),node('p',item.purpose),node('p',`比较：${item.comparison}`),node('p',`指标：${item.metrics.join(' · ')}`,'submission-hint'));
        const controls=node('div');const statusLabel=node('label','进展状态','submission-field');const select=node('select');
        select.id=`status-${item.id}`;statusLabel.htmlFor=select.id;select.disabled=!adopted;
        for(const [value,text]of Object.entries(STATUS_LABELS)){const option=node('option',text);option.value=value;select.append(option);}select.value=record.status;
        const evidenceLabel=node('label','结果文件 / 证据说明','submission-field');const evidence=node('textarea');evidence.id=`evidence-${item.id}`;evidenceLabel.htmlFor=evidence.id;evidence.rows=3;evidence.maxLength=10000;evidence.value=record.evidence;evidence.disabled=!adopted;evidence.placeholder='填写运行配置、结果文件、指标和观察；完成时必填。';
        select.addEventListener('change',()=>callbacks.experiment(item.id,{status:select.value,evidence:evidence.value}));
        evidence.addEventListener('input',()=>callbacks.experiment(item.id,{status:select.value,evidence:evidence.value}));
        statusLabel.append(select);evidenceLabel.append(evidence);controls.append(statusLabel,evidenceLabel);
        if(!adopted)controls.append(node('p','采用这条路线后可记录实验。','submission-hint'));
        card.append(info,controls);return card;
      }));
      byId('journal-context').textContent=adopted?'可选定一个候选期刊，随后对照同刊论文安排章节与图表。':'当前仅预览该场景的候选期刊；采用路线后可选定。';
      byId('journal-list').replaceChildren(...project.journals.filter(item=>scenario.journalIds.includes(item.id)).map(item=>{
        const chosen=state.journalId===item.id&&adopted;
        const card=node('article','',`submission-card${chosen?' submission-card--chosen':''}`),links=node('div','','submission-links');
        const select=button(chosen?'已选为候选期刊':'选为候选期刊',()=>callbacks.journal(item.id));select.disabled=!adopted||chosen;
        links.append(link('期刊官方页面 ↗',item.url));card.append(node('h3',item.name),node('p',item.fit),node('p',item.formatNote,'submission-hint'),select,links);return card;
      }));
      byId('reference-list').replaceChildren(...project.references.filter(item=>scenario.journalIds.includes(item.journalId)).map(item=>{
        const journal=project.journals.find(j=>j.id===item.journalId);
        const card=node('article','','submission-card');const links=node('div','','submission-links');links.append(link('出版社 / DOI ↗',item.url));if(item.documentId)links.append(docLink(project,item.documentId,'打开本地 PDF ↗'));
        card.append(node('div',`${journal?.name||''} · ${item.year} · ${item.versionNote}`,'reference-heading'),node('h3',item.title),node('p',`章节分布：${item.structure}`),node('p',`可借鉴：${item.lesson}`),links);return card;
      }));
    },
    renderProgress(project,state) {
      const scenario=project.scenarios.find(item=>item.id===state.scenarioId),journal=project.journals.find(item=>item.id===state.journalId);
      const applicable=project.experiments.filter(item=>item.scenarioIds.includes(state.scenarioId));
      const done=applicable.filter(item=>state.experiments[item.id]?.status==='done'&&state.experiments[item.id].evidence.trim()).length;
      byId('route-status').textContent=`路线：${scenario?.title||'尚未采用'} · 期刊：${journal?.name||'待选择'}`;
      byId('progress-count').textContent=scenario?`${done}/${applicable.length} 项记录完成`:'待选路线';
      byId('project-status').textContent=done?`已记录 ${done} 项结果 · 待核验`:project.statusLabel;
      byId('sidebar-next').textContent=scenario?scenario.nextStep:'先比较四条路线，核对数据和约束条件，再采用一条作为论文主线。';
      byId('append-outline').disabled=!scenario;
    }
  };
}
