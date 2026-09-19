const {chromium}=require('C:/Users/aidil/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs'),path=require('path');
(async()=>{
 const sources=[1,2,3].map(n=>'data:image/png;base64,'+fs.readFileSync(`C:/Users/aidil/OneDrive/Desktop/job tracker ${n}.png`).toString('base64'));
 const browser=await chromium.launch({headless:true,channel:'msedge',args:['--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:1600,height:1000}});
 page.on('console',m=>console.log(m.text()));
 await page.setContent('<canvas width="1600" height="1000"></canvas>');
 const result=await page.evaluate(async sources=>{
 const imgs=await Promise.all(sources.map(src=>new Promise((r,j)=>{let im=new Image();im.onload=()=>r(im);im.onerror=j;im.src=src})));
 const c=document.querySelector('canvas'),g=c.getContext('2d');
 const ac=new AudioContext();await ac.resume();const dest=ac.createMediaStreamDestination();
 const master=ac.createGain();master.gain.value=.65;master.connect(dest);
 let seed=417;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296*2-1};
 function noise(at,len,vol,freq,whoosh=false){const b=ac.createBuffer(1,Math.ceil(ac.sampleRate*len),ac.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++){let p=i/d.length;d[i]=rand()*(whoosh?Math.pow(Math.sin(Math.PI*p),2):Math.exp(-p*9))}const s=ac.createBufferSource();s.buffer=b;const f=ac.createBiquadFilter();f.type='bandpass';f.Q.value=whoosh?.65:1.2;f.frequency.setValueAtTime(freq,at);if(whoosh)f.frequency.exponentialRampToValueAtTime(550,at+len);const gain=ac.createGain();gain.gain.value=vol;s.connect(f).connect(gain).connect(master);s.start(at)}
 function tick(at){noise(at,.085,.5,2400);noise(at+.035,.05,.22,950)}
 const clamp=v=>Math.max(0,Math.min(1,v)),ease=v=>{v=clamp(v);return v*v*(3-2*v)};
 function rr(x,y,w,h,r,fill){g.fillStyle=fill;g.beginPath();g.roundRect(x,y,w,h,r);g.fill()}
 function txt(s,x,y,size=28,color='#e2e8f0',bold=false){g.fillStyle=color;g.font=`${bold?'700':'400'} ${size}px Arial`;g.fillText(s,x,y)}
 function cursor(x,y,click=false){g.save();g.translate(x,y);g.shadowColor='#0008';g.shadowBlur=5;g.fillStyle='white';g.strokeStyle='#0f172a';g.lineWidth=2;g.beginPath();g.moveTo(0,0);g.lineTo(0,31);g.lineTo(8,24);g.lineTo(15,39);g.lineTo(22,35);g.lineTo(15,21);g.lineTo(27,20);g.closePath();g.fill();g.stroke();g.shadowBlur=0;if(click){g.strokeStyle='#60a5fa';g.lineWidth=5;g.beginPath();g.arc(5,10,29,0,7);g.stroke()}g.restore()}
 // Use screenshot pixels as the interface. Only the date field is overlaid to animate typing.
 function job(t,off=0){g.save();g.translate(off,0);rr(55,160,1490,700,22,'#fff');g.save();g.beginPath();g.roundRect(55,160,1490,700,22);g.clip();
 const z=ease((t-1.5)/2),sx=220+(770-220)*z,sy=32,sw=1140+(520-1140)*z,sh=536+(244-536)*z;
 g.drawImage(imgs[t>=10.4?1:0],sx,sy,sw,sh,55,160,1490,700);
 const px=x=>55+(x-sx)*1490/sw,py=y=>160+(y-sy)*700/sh,k=1490/sw;
 if(t<10.4){g.fillStyle='#fff';g.fillRect(px(891),py(168),312*k,25*k);g.save();g.beginPath();g.rect(px(891),py(168),310*k,25*k);g.clip();g.font=`${13*k}px Arial`;g.fillStyle='#111';let n=Math.floor(clamp((t-4.2)/2.5)*11);let s='13 sep 2026'.slice(0,n);g.fillText(s,px(895),py(186));if(t>=3.9&&t<8.4&&Math.floor(t*3)%2===0)g.fillRect(px(895)+g.measureText(s).width,py(172),1.1*k,16*k);g.restore()}
 if(t>=2.9&&t<12.5){let x=1010,y=182;if(t<3.9){let p=ease((t-2.9));x=1170-160*p;y=275-93*p}else if(t>7.6){let p=ease((t-7.6)/1.7);x=1010+37*p;y=182+60*p}cursor(px(x),py(y),Math.abs(t-3.9)<.15||Math.abs(t-9.6)<.2)}
 g.restore();g.restore()}
 function sheet(t,off=0){g.save();g.translate(off,0);rr(55,160,1490,700,22,'#fff');g.save();g.beginPath();g.roundRect(55,160,1490,700,22);g.clip();g.drawImage(imgs[2],0,0,1675,787,55,160,1490,700);const y=160+667*700/787,h=41*700/787;
 if(t>15.2){g.fillStyle='rgba(37,99,235,0.13)';g.fillRect(55,y,1490,h);g.strokeStyle='#2563eb';g.lineWidth=3;g.strokeRect(95,y,1107,h)}
 g.restore();if(t>17){const p=ease((t-17)/.7);g.globalAlpha=p;rr(160,335,1280,235,20,'#0f172a');txt('PERMOHONAN BERJAYA DIREKOD',200,382,22,'#60a5fa',true);txt('Magnum 4D Berhad',200,429,34,'#fff',true);txt('Operations Executive',200,472,28);txt('13 Sep 2026',200,529,26);rr(810,494,150,49,25,'#dcfce7');txt('Applied',839,527,25,'#166534',true);txt('JobStreet',1020,527,26);g.globalAlpha=1}g.restore()}
 function frame(t){g.fillStyle='#091223';g.fillRect(0,0,1600,1000);txt('JOB TRACKER QUICK ADD',55,55,22,'#60a5fa',true);txt('DEMO BERDASARKAN SCREENSHOT',1130,55,17,'#94a3b8');
 let step=t<3.8?'01  Buka extension pada iklan kerja':t<8?'02  Taip tarikh permohonan':t<10.4?'03  Klik Save to Tracker':t<13?'Berjaya disimpan!':t<17?'04  Buka tab Google Sheets':'Link, tarikh dan status — terus tersusun.';
 txt(step,55,119,38,'#fff',true);
 // Tab strip makes the switch explicit; the spreadsheet screenshot is the supplied result.
 rr(1015,83,240,49,12,t<13?'#2563eb':'#18273e');txt('JobStreet',1040,115,23,'#fff',true);rr(1270,83,275,49,12,t>=13?'#2563eb':'#18273e');txt('Google Sheets',1295,115,23,'#fff',true);
 if(t<13)job(t);else if(t<14){const p=ease(t-13);job(12.8,-1600*p);sheet(t,1600*(1-p))}else sheet(t);
 if(t>12&&t<13.4)cursor(1400,110,Math.abs(t-13)<.18);
 const caption=t<3.8?'Dah apply? Rekod terus daripada tab kerja anda.':t<8?'Masukkan tarikh, contohnya 13 sep 2026.':t<10.4?'Satu klik untuk simpan ke tracker.':t<13?'Mesej “Saved to tracker!” mengesahkan simpanan.':t<17?'Tukar tab untuk lihat rekod dalam spreadsheet.':'Baris 56: permohonan yang tadi kini ada dalam tracker.';
 txt(caption,55,916,29,'#cbd5e1');rr(55,963,1490,5,3,'#1e293b');rr(55,963,1490*clamp(t/24),5,3,'#60a5fa');
 }
 frame(0);const stream=c.captureStream(30);dest.stream.getAudioTracks().forEach(tr=>stream.addTrack(tr));
 const mime='video/mp4';if(!MediaRecorder.isTypeSupported(mime))throw Error('MP4 unsupported');const rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6500000,audioBitsPerSecond:128000});const chunks=[];rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};const done=new Promise((r,j)=>{rec.onstop=r;rec.onerror=j});
 rec.start(1000);const at=ac.currentTime;tick(at+3.9);for(let i=0;i<11;i++)tick(at+4.2+(i+1)*2.5/11);tick(at+9.6);tick(at+13);noise(at+12.95,1.1,.8,4600,true);
 console.log('Recording walkthrough with typing, clicks and whoosh');const start=performance.now();await new Promise(r=>{function next(){const t=(performance.now()-start)/1000;frame(Math.min(t,24));if(t>=24){r();return}setTimeout(next,33)}next()});rec.stop();await done;console.log('Video encoded');stream.getTracks().forEach(t=>t.stop());await ac.close();const blob=new Blob(chunks,{type:mime});return await new Promise(r=>{let fr=new FileReader();fr.onload=()=>r(fr.result.split(',')[1]);fr.readAsDataURL(blob)});
 },sources);
 const out=path.join(__dirname,'job-tracker-demo-draft.mp4');fs.writeFileSync(out,Buffer.from(result,'base64'));console.log(out);
 await page.setContent('<video muted></video>');const meta=await page.evaluate(async data=>{const v=document.querySelector('video');v.src='data:video/mp4;base64,'+data;await new Promise(r=>v.onloadedmetadata=r);v.currentTime=18;await new Promise(r=>v.onseeked=r);return {duration:v.duration,width:v.videoWidth,height:v.videoHeight,audioTracks:v.webkitAudioDecodedByteCount};},result);await page.locator('video').screenshot({path:path.join(__dirname,'demo-preview.png')});console.log(JSON.stringify(meta));await browser.close();
})();
