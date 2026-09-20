import {build} from 'esbuild';
import sharp from 'sharp';
import {mkdir,rm,cp,writeFile,readFile,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('.',import.meta.url));
const require=createRequire(import.meta.url);
const manifest={manifest_version:3,name:'redread – Artikel zum Hören',version:'0.1.0',description:'Sende den aktuellen Artikel an deinen eigenen redread-Server und höre ihn als Podcast.',permissions:['activeTab','scripting','storage'],optional_host_permissions:['http://*/*','https://*/*'],action:{default_popup:'popup.html',default_title:'Mit redread hörbar machen',default_icon:{16:'icons/16.png',32:'icons/32.png'}},icons:{16:'icons/16.png',32:'icons/32.png',48:'icons/48.png',128:'icons/128.png'},options_ui:{page:'options.html',open_in_tab:true}};
await mkdir(join(root,'artifacts'),{recursive:true});
for(const browser of ['chrome','firefox']){
  const outdir=join(root,'dist',browser);
  await rm(outdir,{recursive:true,force:true});await mkdir(outdir,{recursive:true});
  await cp(join(root,'public'),outdir,{recursive:true});
  await build({entryPoints:['background','popup','options'].map(name=>join(root,'src',`${name}.ts`)),bundle:true,outdir,format:'iife',target:['chrome120','firefox142'],legalComments:'eof'});
  await build({entryPoints:[join(root,'src/capture.ts')],bundle:true,outfile:join(outdir,'capture.js'),format:'iife',globalName:'RedreadCapture',target:['chrome120','firefox142'],legalComments:'eof',footer:{js:'(() => { try { return RedreadCapture.capture(); } catch (error) { return {error: error.message}; } })();'}});
  await mkdir(join(outdir,'fonts'),{recursive:true});await mkdir(join(outdir,'icons'),{recursive:true});
  const modules=resolve(root,'../../node_modules');
  await copyFile(join(modules,'@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2'),join(outdir,'fonts/body.woff2'));
  await copyFile(join(modules,'@fontsource/manrope/files/manrope-latin-700-normal.woff2'),join(outdir,'fonts/heading.woff2'));
  for(const size of [16,32,48,128])await sharp(await readFile(resolve(root,'../web/app/icon.svg'))).resize(size,size).png().toFile(join(outdir,`icons/${size}.png`));
  const specific=browser==='chrome'?{minimum_chrome_version:'120',background:{service_worker:'background.js'}}:{background:{scripts:['background.js']},browser_specific_settings:{gecko:{id:'redread@redread.local',strict_min_version:'142.0',data_collection_permissions:{required:['websiteContent','browsingActivity']}}}};
  await writeFile(join(outdir,'manifest.json'),JSON.stringify({...manifest,...specific},null,2)+'\n');
  const notices=await Promise.all([
    readFile(require.resolve('@mozilla/readability/LICENSE.md'),'utf8'),
    readFile(join(modules,'@fontsource/dm-sans/LICENSE'),'utf8'),
    readFile(join(modules,'@fontsource/manrope/LICENSE'),'utf8'),
  ]);
  await writeFile(join(outdir,'THIRD_PARTY_NOTICES.txt'),['Mozilla Readability','DM Sans','Manrope'].map((name,i)=>`${name}\n${notices[i]}`).join('\n\n'));
  const archive=join(root,'artifacts',`redread-${browser}.zip`);
  await rm(archive,{force:true});execFileSync('zip',['-qr',archive,'.'],{cwd:outdir});
  const downloads=resolve(root,'../web/public/extensions');
  await mkdir(downloads,{recursive:true});await copyFile(archive,join(downloads,`redread-${browser}.zip`));
  console.log(`${browser}: ${outdir}\n  ${archive}`);
}
