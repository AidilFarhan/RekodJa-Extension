const {chromium}=require('C:/Users/aidil/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs');
const path=require('path');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const page=await browser.newPage({viewport:{width:1120,height:1960},deviceScaleFactor:1});
 page.on('console',m=>console.log(m.text()));
 await page.goto('file:///'+path.join(__dirname,'job-tracker-promo.html').replaceAll('\\','/'));
 const images=[];
 for(let i=0;i<6;i++){
  const file=path.join(__dirname,`scene-${i+1}.png`);
  await page.locator('.page').nth(i).screenshot({path:file});
  images.push('data:image/png;base64,'+fs.readFileSync(file).toString('base64'));
 }
 await page.setContent('<html><body style="margin:0"><canvas width="540" height="960"></canvas></body></html>');
 const data=await page.evaluate(async(sources)=>{
  const imgs=await Promise.all(sources.map(src=>new Promise(r=>{const im=new Image();im.onload=()=>r(im);im.src=src})));
  console.log('Images loaded');
  const c=document.querySelector('canvas'),ctx=c.getContext('2d');
  const stream=c.captureStream(30);
  const mime='video/webm;codecs=vp8';
  const rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:3500000});
  const chunks=[];rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  const done=new Promise(r=>rec.onstop=r);
  function draw(i,p,alpha=1){ctx.save();ctx.globalAlpha=alpha;const scale=1+p*.025;const w=540*scale,h=960*scale;ctx.drawImage(imgs[i],(540-w)/2,(960-h)/2,w,h);ctx.restore()}
  draw(0,0);rec.start(1000);console.log('Recording started');const start=performance.now();
  await new Promise(resolve=>{function frame(){const now=performance.now();const t=Math.min((now-start)/1000,29.999);const i=Math.floor(t/5),p=(t%5)/5;ctx.fillStyle='#0b1224';ctx.fillRect(0,0,540,960);draw(i,p);if(p>.9&&i<5)draw(i+1,0,(p-.9)/.1);if(now-start>=30000){resolve();return}setTimeout(frame,33)}frame()});
  console.log('Recording stopping');rec.stop();await done;console.log('Recording saved');stream.getTracks().forEach(t=>t.stop());
  const blob=new Blob(chunks,{type:mime});
  return {ext:mime.startsWith('video/mp4')?'mp4':'webm',base64:await new Promise(r=>{const reader=new FileReader();reader.onload=()=>r(reader.result.split(',')[1]);reader.readAsDataURL(blob)})};
 },images);
 const outfile=path.join(__dirname,'job-tracker-promo-draft.'+data.ext);fs.writeFileSync(outfile,Buffer.from(data.base64,'base64'));
 await page.setContent('<video muted></video>');
 const metadata=await page.evaluate(async({base64,ext})=>{const v=document.querySelector('video');v.src=`data:video/${ext};base64,${base64}`;await new Promise((r,j)=>{v.onloadedmetadata=r;v.onerror=j});return {width:v.videoWidth,height:v.videoHeight,duration:v.duration}},data);
 console.log(JSON.stringify({outfile,bytes:fs.statSync(outfile).size,...metadata}));
 await browser.close();
})();
