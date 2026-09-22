
async function measureLatency(){
  const samples=[];
  // Ignore the first request as a warm-up sample.
  for(let i=0;i<9;i++){
    const t=performance.now();
    try{
      await fetch("https://speed.cloudflare.com/__down?bytes=10000&cachebust="+Date.now()+"_"+i,
        {cache:"no-store",mode:"cors"});
      const ms=performance.now()-t;
      if(i>0) samples.push(ms);
    }catch(e){}
  }
  if(!samples.length) return null;
  samples.sort((a,b)=>a-b);
  const median=samples[Math.floor(samples.length/2)];
  const deviations=samples.map(x=>Math.abs(x-median));
  const jitter=deviations.reduce((a,b)=>a+b,0)/deviations.length;
  return {avg:median,jitter};
}

function updateSpeedProgress(startTime, label, targetSeconds){
  const elapsed=(performance.now()-startTime)/1000;
  const remaining=Math.max(0,targetSeconds-elapsed);
  $("speedPhase").textContent=label+" · "+remaining.toFixed(1)+"s";
  return elapsed;
}

async function measureDownload(){
  // Multiple concurrent streams reduce the chance that one HTTP connection
  // becomes the bottleneck on a mobile network.
  const targetSeconds=15;
  const streams=4;
  const chunkSize=10000000; // 10 MB
  const start=performance.now();
  let received=0;
  let active=true;

  async function worker(id){
    let n=0;
    while(active){
      const url="https://speed.cloudflare.com/__down?bytes="+chunkSize+
        "&cachebust="+Date.now()+"_"+id+"_"+n;
      try{
        const r=await fetch(url,{cache:"no-store",mode:"cors"});
        const data=await r.arrayBuffer();
        received += data.byteLength;
        n++;
      }catch(e){
        // Keep other streams alive if one request fails.
      }
    }
  }

  const workers=Array.from({length:streams},(_,i)=>worker(i));
  const timer=setInterval(()=>{
    const seconds=(performance.now()-start)/1000;
    if(seconds>0){
      const mbps=received*8/seconds/1000000;
      $("downloadSpeed").textContent=mbps.toFixed(1);
      $("speedValue").textContent=mbps.toFixed(1);
    }
    updateSpeedProgress(start,"MEASURING DOWNLOAD",targetSeconds);
  },250);

  await new Promise(resolve=>setTimeout(resolve,targetSeconds*1000));
  active=false;
  await Promise.allSettled(workers);
  clearInterval(timer);

  const seconds=(performance.now()-start)/1000;
  return received*8/seconds/1000000;
}

async function measureUpload(){
  const targetSeconds=15;
  const streams=4;
  const chunkSize=1000000; // 1 MB per POST
  const payload=new Uint8Array(chunkSize);
  if(window.crypto && crypto.getRandomValues){
    crypto.getRandomValues(payload.subarray(0,65536));
  }

  const start=performance.now();
  let sent=0;
  let active=true;

  async function worker(id){
    let n=0;
    while(active){
      try{
        const r=await fetch(
          "https://speed.cloudflare.com/__up?cachebust="+Date.now()+"_"+id+"_"+n,
          {method:"POST",body:payload,cache:"no-store",mode:"cors"}
        );
        if(!r.ok) break;
        sent += chunkSize;
        n++;
        await r.text().catch(()=>{});
      }catch(e){}
    }
  }

  const workers=Array.from({length:streams},(_,i)=>worker(i));
  const timer=setInterval(()=>{
    const seconds=(performance.now()-start)/1000;
    if(seconds>0){
      const mbps=sent*8/seconds/1000000;
      $("uploadSpeed").textContent=mbps.toFixed(1);
    }
    updateSpeedProgress(start,"MEASURING UPLOAD",targetSeconds);
  },250);

  await new Promise(resolve=>setTimeout(resolve,targetSeconds*1000));
  active=false;
  await Promise.allSettled(workers);
  clearInterval(timer);

  const seconds=(performance.now()-start)/1000;
  return sent*8/seconds/1000000;
}

async function runSpeedTest(){
  const btn=$("speedBtn"), status=$("speedStatus"), phase=$("speedPhase");
  btn.disabled=true;
  btn.textContent="TESTING…";
  status.textContent="TESTING";
  phase.textContent="PREPARING";
  $("speedValue").textContent="—";
  $("downloadSpeed").textContent="—";
  $("uploadSpeed").textContent="—";
  $("speedPing").textContent="—";
  $("speedJitter").textContent="—";

  try{
    phase.textContent="MEASURING LATENCY";
    const lat=await measureLatency();
    if(lat){
      $("speedPing").textContent=Math.round(lat.avg);
      $("speedJitter").textContent=Math.round(lat.jitter);
    }

    phase.textContent="MEASURING DOWNLOAD · ~15s";
    const down=await measureDownload();
    $("downloadSpeed").textContent=down.toFixed(1);
    $("speedValue").textContent=down.toFixed(1);

    phase.textContent="MEASURING UPLOAD · ~15s";
    try{
      const up=await measureUpload();
      $("uploadSpeed").textContent=up.toFixed(1);
    }catch(e){
      $("uploadSpeed").textContent="N/A";
    }

    phase.textContent="TEST COMPLETE";
    status.textContent="DONE";
  }catch(e){
    console.error(e);
    status.textContent="ERROR";
    phase.textContent="SPEED TEST FAILED";
    $("speedValue").textContent="—";
  }finally{
    btn.disabled=false;
    btn.textContent="↻ RUN SPEED TEST";
  }
}

async function mobile(){
  try{
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

    const type = c && c.type ? c.type : "Unknown";
    const effective = c && c.effectiveType ? c.effectiveType : "Unknown";
    const downlink = c && typeof c.downlink === "number" ? c.downlink : null;
    const rtt = c && typeof c.rtt === "number" ? c.rtt : null;
    const saveData = c && typeof c.saveData === "boolean" ? c.saveData : null;

    let generation = "UNKNOWN";
    if(effective === "slow-2g") generation = "2G";
    else if(effective === "2g") generation = "2G";
    else if(effective === "3g") generation = "3G";
    else if(effective === "4g") generation = "4G / 5G";

    $("#operator").textContent =
      type === "cellular" ? "Cellular network" :
      type === "wifi" ? "Wi-Fi" :
      type === "ethernet" ? "Ethernet" :
      type || "Unknown";

    $("#mobileType").textContent =
      type === "cellular" ? "Cellular" : (type || "Unknown");

    $("#mobileGen").textContent = generation;

    $("#publicIp").textContent =
      "Browser network detected";

    $("#dns").textContent =
      downlink !== null ? "Est. " + downlink + " Mbps" : "Not exposed";

    $("#dataState").textContent =
      navigator.onLine ? "Online" : "Offline";

    $("#simState").textContent =
      saveData === true ? "Data Saver ON" :
      saveData === false ? "Data Saver OFF" :
      "Browser API";

    $("#signalDetail").textContent =
      (rtt !== null ? "RTT: " + rtt + " ms" : "RTT unavailable") +
      (effective !== "Unknown" ? " | Effective: " + effective : "");

  }catch(e){
    console.error("Browser network info error:", e);
  }
}
const $=x=>document.getElementById(x);
const fmt=b=>{let u=["B/s","KB/s","MB/s","GB/s"],i=0;while(b>=1024&&i<3){b/=1024;i++}return b.toFixed(i?1:0)+" "+u[i]};
function clock(){ $("clock").textContent=new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"}); }
async function refresh(){
 try{
  let s=await(await fetch("/api/system")).json(),p=await(await fetch("/api/stats")).json();
  $("host").textContent=(s.interface&&s.interface!=="Unknown"?s.interface:"local")||"local";
  $("down").textContent=fmt(s.download_bps); $("up").textContent=fmt(s.upload_bps);
  $("packets").textContent=p.packets; $("protocols").textContent=`TCP ${p.tcp} · UDP ${p.udp}`;
  $("tcp").textContent=p.tcp;$("udp").textContent=p.udp;$("icmp").textContent=p.icmp;$("ipv4").textContent=p.ipv4;
  $("net").textContent=(s.network.addresses||"No address data")+"\n\nRoutes:\n"+(s.network.routes||"No route data");
  $("liveText").textContent=s.capture_running?"PACKET ENGINE ACTIVE":"SYSTEM ONLINE";
  $("netState").textContent=s.capture_running?"CAPTURING":"CONNECTED";
  $("feed").innerHTML=p.last_packets.length?p.last_packets.map(x=>`<div class="row"><span>${x.time}</span><span>${x.proto}</span><span>${x.src||"—"} → ${x.dst||"—"}</span><span>${x.size} B</span></div>`).join(""):'<div class="empty">No packets captured yet.</div>';
 }catch(e){$("liveText").textContent="OFFLINE"}
}
async function capture(on){let r=await fetch("/api/capture/"+(on?"start":"stop"),{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});let j=await r.json();if(j.error){$("result").innerHTML=`<span class="dot"></span><span>${j.error}</span>`}}
async function scan(){
 let target=$("target").value.trim(),ports=$("ports").value.split(",").map(x=>x.trim()).filter(Boolean);
 $("result").innerHTML='<span class="dot"></span><span>Scanning authorized target…</span>';
 let j=await(await fetch("/api/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({target,ports})})).json();
 $("result").innerHTML=j.ok?`<span class="dot" style="background:#45f0a2"></span><span>Open TCP ports: <b>${j.open_ports.join(", ")||"none"}</b> · ${j.duration}s</span>`:`<span class="dot"></span><span>${j.error||"Scan failed"}</span>`;
 history();
}
async function ping(){
 let target=$("target").value.trim();$("result").innerHTML='<span class="dot"></span><span>Pinging target…</span>';
 let j=await(await fetch("/api/ping",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({target})})).json();
 $("result").innerHTML=j.ok?`<span class="dot" style="background:#45f0a2"></span><span>Reachable · <b>~${j.latency_ms} ms</b></span>`:`<span class="dot"></span><span>No reply</span>`;
}
async function history(){
 let h=await(await fetch("/api/history")).json();
 $("history").innerHTML='<div class="hrow head"><span>TIME</span><span>TARGET</span><span>OPEN PORTS</span></div>'+
 (h.length?h.map(x=>`<div class="hrow"><span>${x.created_at}</span><span>${x.target}</span><span class="open">${x.open_ports||"none"}</span></div>`).join(""):'<div class="empty">No scans yet.</div>');
}
refresh();mobile();history();clock();setInterval(refresh,2000);setInterval(mobile,10000);setInterval(clock,1000);
