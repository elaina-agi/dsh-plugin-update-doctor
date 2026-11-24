import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=relative=>fs.readFile(path.join(root,relative),'utf8');
const primary=['README.md','docs/DETAIL.md','docs/RELEASE_NOTES_0_5_1.md','docs/RELEASE_REVIEW_0_5_1.md'];

test('release copy separates Union risk blocking from an independently shipped fix',async()=>{
 for(const file of primary){const text=await read(file);assert(text.includes('Union Search'),file);assert(/(?:不支持|不能完整解决)/u.test(text),file);assert(/(?:风险拦截|风险处理)/u.test(text),file);}
 const zh=JSON.parse(await read('locale/zh.json')),en=JSON.parse(await read('locale/en.json'));
 assert(zh.meta.description.includes('不算修复'));assert(zh.meta.description.includes('完整依赖本地代际'));assert(zh.meta.description.includes('尚未全面验收'));
 assert(en.meta.description.includes('which is not a fix'));assert(en.meta.description.includes('Second-device'));assert(en.meta.description.includes('remain incomplete'));
 const client=await read('client.js');assert(client.includes('本更新器只拦截风险'));assert(client.includes('it does not fix Host reload'));
});

test('user-facing release docs keep source migration and byte/refetch guarantees narrow',async()=>{
 const notes=await read('docs/RELEASE_NOTES_0_5_1.md');
 assert(notes.includes('同一版本'));assert(notes.includes('额外确认'));assert(notes.includes('声明不变'));assert(notes.includes('已有会话'));assert(notes.includes('不是原子替换'));assert(notes.includes('浏览器交互验收'));
 const main=await read('README.md');assert(main.includes('结果已知'));assert(main.includes('当前安装身份与记录匹配'));assert(main.includes('未知结果和未获准路径的Union Search'));assert(main.includes('0.5.2'));assert(main.includes('完整依赖本地代际'));
 assert(main.includes('无需为此修改全局源'));assert(main.includes('一次引导升级'));assert(main.includes('不能将这次引导安装称为旧版在原配置下成功自更新'));
});

test('documentation separates tested user results, runtime requirements and remaining validation',async()=>{
 const main=await read('README.md'),requirements=await read('docs/WINDOWS_REQUIREMENTS.md'),verification=await read('docs/VERIFICATION.md'),wsl=await read('docs/WSL_STRUCTURAL_0_5_3.md'),windows=await read('docs/WINDOWS_SUPPORT.md'),detail=await read('docs/DETAIL.md');
 for(const [file,text]of [['README.md',main],['docs/VERIFICATION.md',verification],['docs/WSL_STRUCTURAL_0_5_3.md',wsl]]){assert(text.includes('0.29.0'),file);assert(text.includes('16/16'),file);}
 assert(main.includes('第二台设备尚未实测'));assert(main.includes('不再仅限固定版本名单'));assert(main.includes('真实网络fallback切换'));assert(!main.includes('目前的 WSL 特例仅接受已验证版本'));
 assert(requirements.includes('DSH实际执行插件的Node ≥24'));assert(requirements.includes('.NET Framework 4.x'));assert(requirements.includes('不需要C#编译器'));assert(requirements.includes('诊断未知并不是所有路线的统一硬阻断'));assert(requirements.includes('历史验收包不被覆盖'));assert(!/Flyking|C:[\\/]/.test(requirements));
 assert(verification.includes('22:12:13–22:12:29'));assert(verification.includes('没有触发旧版恢复'));assert(windows.includes('0.5.4来源修复'));assert(windows.includes('0.5.1阶段已实现的路径（历史）'));assert(windows.includes('完整依赖本地代际路线'));
 assert(detail.includes('第二台设备'));assert(detail.includes('.NET Framework 4.x'));assert(!detail.includes('真实用户升级和新界面浏览器交互尚未验收'));
 for(const file of ['docs/RELEASE_NOTES_0_5_1.md','docs/RELEASE_REVIEW_0_5_1.md'])assert((await read(file)).includes('历史快照'));
});

test('packaged copy contains no transient publication status or hard-coded npm latest value',async()=>{
 const docs=await fs.readdir(path.join(root,'docs'));
 const files=['README.md','locale/zh.json','locale/en.json',...docs.filter(file=>file.endsWith('.md')).map(file=>'docs/'+file)];
 const transient=/(?:尚未|未)发布|未推送|(?:is |has |have )?not (?:yet )?(?:been )?published|Public npm (?:remains|is) v\d|公共\s*npm[^。\n]{0,24}(?:仍为|仍是|仍|当前为)|latest\s*(?:=|：|:|指向|为)\s*[`"']?v?\d|来源修复候选|Candidate v0\.5/i;
 for(const file of files){const text=await read(file);assert(!transient.test(text),file+' embeds a time-sensitive publication state');}
 const main=await read('README.md');assert(main.includes('可用版本以管理器的实际查询为准'));assert(main.includes('dsh-plugin-update-doctor\n```'));assert(main.includes('指定某个已提供的版本'));
 assert(!/dsh-plugin-update-doctor@0\.5\.[034]/.test(main),'installation guide should not pin a stale recommended version');
});

test('packaged documentation contains no core research and its local links stay within shipped resources',async()=>{
 const manifest=JSON.parse(await read('package.json'));assert(manifest.files.includes('docs'));assert(!manifest.files.includes('experiments'));
 const docs=await fs.readdir(path.join(root,'docs'));assert(!docs.includes('UNION_HOT_RELOAD.md'));assert(!docs.includes('UNION_RUNTIME_HANDOFF.md'));
 const packaged=file=>file==='README.md'||file==='LICENSE'||manifest.files.some(selector=>file===selector||file.startsWith(selector+'/'));
 for(const file of ['README.md',...docs.filter(file=>file.endsWith('.md')).map(file=>'docs/'+file)]){
  const text=await read(file);
  for(const match of text.matchAll(/\]\(<([^>]+)>\)/g)){
   const link=match[1];if(/^[a-z][a-z0-9+.-]*:/i.test(link)||link.startsWith('#'))continue;
   const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),link.split('#')[0]));
   assert(!target.startsWith('../'),file+' escapes package');assert(packaged(target),file+' links to unshipped '+target);
   assert((await fs.stat(path.join(root,target))).isFile(),file+' missing '+target);
  }
 }
 const summary=await read('docs/VERIFICATION.md');assert(!summary.includes('Union核心修复完成验证'));assert(summary.includes('本页记录更新器本身的验证'));
});
