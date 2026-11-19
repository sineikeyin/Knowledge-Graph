import {seedProjects,seedWells} from './sample-data.js';
import {ingEnsure,ingId,ingRecordUpload,ingSetParsed,ingMutation,ingMappingRevision} from './ingestion-model.js';
import {ingParse,ingKey} from './ingestion-core.js';

export const ingDemoSeedVersion='m2-governance-demo-v1';
const ingDemoCsvCell=value=>`"${String(value).replace(/"/g,'""')}"`;
const ingDemoCsv=rows=>rows.map(row=>row.map(ingDemoCsvCell).join(',')).join('\n')+'\n';
const ingDemoByteLength=text=>encodeURIComponent(text).replace(/%[\dA-F]{2}|./g,'x').length;
const ingDemoAliasNames=(project,well)=>({well:`[演示] ${well.short}旧井名`,layer:`[演示] ${well.layer}旧层名`,lithology:'[演示] 砂岩旧称',block:`[演示] ${project.block}旧区块名`});

// Only seed the application's unchanged, fictional starter projects/wells, never user-created projects.
export function ingDemoFixtures(db){
  const fixtures=[];
  for(const template of seedProjects){
    const project=db.projects.find(item=>item.id===template.id&&item.name===template.name&&item.block===template.block);if(!project)continue;
    const wells=seedWells.filter(templateWell=>project.wells.includes(templateWell.id)).map(templateWell=>db.wells.find(well=>well.id===templateWell.id&&well.short===templateWell.short&&well.name===templateWell.name&&well.layer===templateWell.layer)).filter(Boolean);
    for(const well of wells){
      const alias=ingDemoAliasNames(project,well),key=`${project.id}-${well.id}`;
      fixtures.push({key:`${key}-stratum`,projectId:project.id,wellId:well.id,objectType:'stratum',scenario:'passed',name:`${well.short}_分层归一与版本.csv`,text:ingDemoCsv([['井名','层位','顶深','底深','深度单位','深度类型','参考基准','岩性','区块'],[alias.well,alias.layer,100,108,'m','MD','KB',alias.lithology,alias.block]])});
      fixtures.push({key:`${key}-issues`,projectId:project.id,wellId:well.id,objectType:'stratum',scenario:'blocked',name:`${well.short}_质量阻断问题.csv`,text:ingDemoCsv([['井名','层位','顶深','底深','深度单位','深度类型','参考基准'],[well.short,'[演示] 待确认层位',128,120,'m','MD','KB']])});
      fixtures.push({key:`${key}-log`,projectId:project.id,wellId:well.id,objectType:'log',scenario:'warning',name:`${well.short}_测井曲线警告.json`,text:JSON.stringify({records:[80,82,180].map((value,index)=>({'井名':well.short,'井深':[100,100.5,102][index],'曲线名':'GR','曲线值':value,'曲线单位':'API','深度单位':'m','深度类型':'MD','参考基准':'KB','事件时间':`2026-11-19T10:00:0${index}+08:00`}))},null,2)+'\n'});
    }
    if(wells.length){const well=wells[0];fixtures.push({key:`${project.id}-${well.id}-failed`,projectId:project.id,wellId:well.id,objectType:'stratum',scenario:'failed',name:`${well.short}_解析失败样例.csv`,text:'井名,层位,顶深,底深,深度单位,深度类型,参考基准\n'+ingDemoCsv([[well.short,well.layer,100,108]])});}
  }
  return fixtures;
}

// Uses the same normalization, validation and handoff code as user operations. Nothing is marked
// passed by assignment. Local service supplies real hashes/files; offline mode supplies demo IDs.
export function ingSeedDemo(db,fileManifest={},fixtures=ingDemoFixtures(db)){
  const ig=ingEnsure(db);let renamed=false;
  for(const asset of db.assets.filter(item=>item.demo&&item.seedVersion===ingDemoSeedVersion)){
    const name=asset.name.replace(/^\s*(?:\[演示\]|【演示】)\s*/,'');if(name!==asset.name){asset.name=name;renamed=true;}
    for(const version of ig.versions.filter(item=>item.assetId===asset.id)){const fileName=version.fileName.replace(/^\s*(?:\[演示\]|【演示】)\s*/,'');if(fileName!==version.fileName){version.fileName=fileName;renamed=true;}}
  }
  if(ig.demoSeed?.version===ingDemoSeedVersion){if(ig.demoSeed.namingVersion!=='plain-v1'){ig.demoSeed.namingVersion='plain-v1';renamed=true;}return {changed:renamed,summary:ig.demoSeed};}
  const role=db.roles.find(item=>['manage','data','import','construction'].every(permission=>item.permissions.includes(permission)));
  if(!role||!fixtures.length)return {changed:false,reason:'未找到兼容的演示项目或初始化角色。'};
  const actor={id:'system-governance-demo',account:'system-demo',name:'系统演示初始化',roleId:role.id,enabled:true};
  const now=new Date().toISOString(),scopes=new Set(fixtures.map(item=>`${item.projectId}:${item.wellId}`));
  for(const scope of scopes){
    const [projectId,wellId]=scope.split(':'),project=db.projects.find(item=>item.id===projectId),well=db.wells.find(item=>item.id===wellId),aliases=ingDemoAliasNames(project,well);
    for(const [kind,standardName]of [['well',well.short],['layer',well.layer],['lithology','砂岩'],['block',project.block]]){
      if(ig.aliases.some(item=>item.demo&&item.projectId===projectId&&item.wellId===wellId&&item.kind===kind&&ingKey(item.rawName)===ingKey(aliases[kind])))continue;
      ig.aliases.push({id:ingId(db,'MAP'),projectId,wellId,kind,rawName:aliases[kind],standardName,revision:1,updatedAt:now,updatedBy:actor.name,demo:true,demoKey:`${scope}-${kind}`,seedVersion:ingDemoSeedVersion});
    }
  }
  const ids=[];
  for(const fixture of fixtures){
    const existing=db.assets.find(item=>item.demoKey===fixture.key&&item.seedVersion===ingDemoSeedVersion);if(existing){ids.push(existing.id);continue;}
    const file=fileManifest[fixture.key]||{fileId:`offline-demo-${fixture.key}`,hash:`offline-demo-${fixture.key}`,size:ingDemoByteLength(fixture.text)};
    const result=ingRecordUpload(db,actor,{...fixture,...file,encoding:'utf-8'});
    if(result.duplicate)continue;
    const asset=db.assets.find(item=>item.id===result.assetId),version=ig.versions.find(item=>item.id===result.versionId),job=ig.jobs.find(item=>item.id===result.jobId);
    Object.assign(asset,{demo:true,demoKey:fixture.key,seedVersion:ingDemoSeedVersion,source:'系统演示资料（虚构）'});Object.assign(version,{demo:true,seedVersion:ingDemoSeedVersion,mappingRevision:ingMappingRevision(db,asset)});Object.assign(job,{demo:true,seedVersion:ingDemoSeedVersion});
    ids.push(asset.id);
    let parsed,error;try{parsed=ingParse(fixture.text,fixture.name.split('.').at(-1));}catch(cause){error=cause.message;}
    ingSetParsed(db,job.id,parsed,error);if(error)continue;
    const body={assetId:asset.id,versionId:version.id};
    ingMutation(db,actor,'validate',{...body,options:fixture.scenario==='warning'?{max:100,maxGap:1,maxJump:50}:{}});
    if(fixture.scenario==='passed'){
      const corrected=ingMutation(db,actor,'correct',{...body,row:1,field:'bottom',value:'111'});
      ingMutation(db,actor,'validate',{assetId:asset.id,versionId:corrected.versionId});
      ingMutation(db,actor,'handoff',{assetId:asset.id,versionId:corrected.versionId});
    }
  }
  ig.demoSeed={version:ingDemoSeedVersion,namingVersion:'plain-v1',initializedAt:now,assetIds:ids,description:'系统预置的虚构治理演示记录；不代表真实井资料或现场结论。'};
  return {changed:true,summary:ig.demoSeed};
}
