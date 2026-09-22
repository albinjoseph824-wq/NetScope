from flask import Flask, render_template, jsonify, request, Response
import socket, subprocess, platform, threading, time, sqlite3, csv, io
from datetime import datetime

try:
    from scapy.all import sniff, IP, IPv6, TCP, UDP, ICMP
    SCAPY_AVAILABLE = True
except Exception:
    SCAPY_AVAILABLE = False

app=Flask(__name__)
DB="netscope.db"
capture_running=False
stats={"packets":0,"bytes":0,"tcp":0,"udp":0,"icmp":0,"ipv4":0,"ipv6":0,"other":0,"last_packets":[]}
last_rx=last_tx=last_t=None

def db():
    c=sqlite3.connect(DB); c.row_factory=sqlite3.Row; return c

def init_db():
    c=db()
    c.execute("""CREATE TABLE IF NOT EXISTS scans(
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT,target TEXT,
      ports TEXT,open_ports TEXT,duration REAL)""")
    c.commit(); c.close()

def cmd(s):
    try: return subprocess.check_output(s,shell=True,text=True,stderr=subprocess.DEVNULL,timeout=2).strip()
    except: return ""

def network_info():
    routes=cmd("ip route")
    addrs=cmd("ip -o addr show")
    return {"routes":routes,"addresses":addrs}

def active_interface():
    # Prefer the interface used by the default route. This avoids counting
    # unrelated idle interfaces (loopback, Wi-Fi, VPN, etc.) on Android.
    routes=cmd("ip route")
    for line in routes.splitlines():
        parts=line.split()
        if parts and parts[0] == "default" and "dev" in parts:
            try: return parts[parts.index("dev")+1]
            except Exception: pass
    return ""

def interface_counters(iface):
    if not iface: return 0,0
    try:
        with open("/proc/net/dev") as f:
            for line in f:
                if ":" not in line: continue
                name, data=line.split(":",1)
                if name.strip()!=iface: continue
                vals=data.split()
                if len(vals)>=9:
                    return int(vals[0]), int(vals[8])
    except Exception: pass
    return 0,0

def net_rate():
    global last_rx,last_tx,last_t,last_iface
    now=time.time()
    iface=active_interface()
    rx,tx=interface_counters(iface)
    # Reset the baseline when Android changes between mobile data/Wi-Fi/VPN.
    if last_t is None or iface != last_iface:
        last_rx,last_tx,last_t,last_iface=rx,tx,now,iface
        return 0,0,iface
    dt=max(now-last_t,.001)
    down=max(0,(rx-last_rx)/dt); up=max(0,(tx-last_tx)/dt)
    last_rx,last_tx,last_t=rx,tx,now
    return down,up,iface

def packet(pkt):
    stats["packets"]+=1; stats["bytes"]+=len(pkt)
    proto="OTHER"; src=dst=""
    if IP in pkt:
        stats["ipv4"]+=1; src,dst=pkt[IP].src,pkt[IP].dst
        if TCP in pkt: stats["tcp"]+=1; proto="TCP"
        elif UDP in pkt: stats["udp"]+=1; proto="UDP"
        elif ICMP in pkt: stats["icmp"]+=1; proto="ICMP"
    elif IPv6 in pkt:
        stats["ipv6"]+=1; src,dst=pkt[IPv6].src,pkt[IPv6].dst
        if TCP in pkt: stats["tcp"]+=1; proto="TCP"
        elif UDP in pkt: stats["udp"]+=1; proto="UDP"
    else: stats["other"]+=1
    stats["last_packets"].insert(0,{"time":datetime.now().strftime("%H:%M:%S"),
      "proto":proto,"src":src,"dst":dst,"size":len(pkt)})
    stats["last_packets"]=stats["last_packets"][:50]

def capture_worker(iface=None):
    global capture_running
    try: sniff(iface=iface or None,prn=packet,store=False,stop_filter=lambda p:not capture_running)
    except: pass
    capture_running=False


def prop(name):
    try:
        return subprocess.check_output(["getprop", name], text=True,
                                       stderr=subprocess.DEVNULL, timeout=1).strip()
    except Exception:
        return ""

def mobile_info():
    network = prop("gsm.network.type") or prop("gsm.operator.alpha") or "Unknown"
    operator = prop("gsm.operator.alpha") or prop("gsm.sim.operator.alpha") or "Unknown"
    numeric = prop("gsm.operator.numeric") or prop("gsm.sim.operator.numeric") or "Unknown"
    sim_state = prop("gsm.sim.state") or "Unknown"
    data_state = prop("gsm.data.state") or "Unknown"
    # Android often exposes values such as LTE, NR, NR/LTE, HSPA.
    n = network.upper()
    if "NR" in n:
        generation = "5G"
    elif "LTE" in n:
        generation = "4G / LTE"
    elif any(x in n for x in ("HSPA", "UMTS", "WCDMA")):
        generation = "3G"
    elif any(x in n for x in ("GPRS", "EDGE")):
        generation = "2G"
    else:
        generation = network

    dns = []
    for key in ("net.dns1", "net.dns2", "net.dns3", "net.dns4"):
        value = prop(key)
        if value and value not in dns:
            dns.append(value)

    public_ip = "Unavailable"
    try:
        import urllib.request
        with urllib.request.urlopen("https://api.ipify.org", timeout=3) as r:
            public_ip = r.read().decode().strip()
    except Exception:
        pass

    # Best-effort signal extraction. Availability depends on Android/OEM permissions.
    signal = "Not exposed by Android"
    try:
        raw = subprocess.check_output(
            ["sh", "-c", "dumpsys telephony.registry 2>/dev/null | grep -E 'mSignalStrength|mLteRsrp|mNrSsRsrp' | head -n 5"],
            text=True, stderr=subprocess.DEVNULL, timeout=2
        ).strip()
        if raw:
            signal = raw[:300]
    except Exception:
        pass

    return {
        "operator": operator,
        "numeric": numeric,
        "network_type": network,
        "generation": generation,
        "sim_state": sim_state,
        "data_state": data_state,
        "dns": dns,
        "public_ip": public_ip,
        "signal": signal
    }

@app.get("/")
def index(): return render_template("index.html")

@app.get("/api/system")
def system():
    down,up,iface=net_rate()
    return jsonify({"hostname":socket.gethostname(),"platform":platform.platform(),
      "network":network_info(),"download_bps":down,"upload_bps":up,
      "interface":iface or "Unknown","capture_available":SCAPY_AVAILABLE,"capture_running":capture_running})

@app.get("/api/mobile")
def mobile():
    return jsonify(mobile_info())

@app.get("/api/stats")
def getstats(): return jsonify(stats)

@app.post("/api/capture/start")
def start():
    global capture_running
    if not SCAPY_AVAILABLE: return jsonify({"ok":False,"error":"Scapy unavailable"}),400
    if not capture_running:
        capture_running=True
        iface=(request.json or {}).get("interface")
        threading.Thread(target=capture_worker,args=(iface,),daemon=True).start()
    return jsonify({"ok":True})

@app.post("/api/capture/stop")
def stop():
    global capture_running
    capture_running=False
    return jsonify({"ok":True})

@app.post("/api/ping")
def ping():
    target=(request.json or {}).get("target","").strip()
    if not target or len(target)>253:return jsonify({"ok":False,"error":"Invalid target"}),400
    cmdline=["ping","-c","1","-W","1",target]
    try:
        t=time.perf_counter(); p=subprocess.run(cmdline,capture_output=True,text=True,timeout=3)
        return jsonify({"ok":p.returncode==0,"latency_ms":round((time.perf_counter()-t)*1000,1),
          "output":(p.stdout or p.stderr)[-1000:]})
    except Exception as e:return jsonify({"ok":False,"error":str(e)}),500

@app.post("/api/scan")
def scan():
    d=request.json or {}; target=str(d.get("target","")).strip(); ports=d.get("ports",[])
    if len(ports)>100:return jsonify({"ok":False,"error":"Maximum 100 ports"}),400
    try: ip=socket.gethostbyname(target)
    except:return jsonify({"ok":False,"error":"Target could not be resolved"}),400
    clean=[]
    for p in ports:
        try:
            n=int(p)
            if 1<=n<=65535:clean.append(n)
        except:pass
    clean=list(dict.fromkeys(clean)); opened=[]; t=time.perf_counter()
    for port in clean:
        s=socket.socket(); s.settimeout(.35)
        try:
            if s.connect_ex((ip,port))==0:opened.append(port)
        finally:s.close()
    dur=time.perf_counter()-t
    c=db(); c.execute("INSERT INTO scans(created_at,target,ports,open_ports,duration) VALUES(?,?,?,?,?)",
      (datetime.now().isoformat(timespec="seconds"),target,",".join(map(str,clean)),
       ",".join(map(str,opened)),dur)); c.commit(); c.close()
    return jsonify({"ok":True,"target":target,"resolved":ip,"open_ports":opened,"duration":round(dur,2)})

@app.get("/api/history")
def history():
    c=db(); rows=[dict(r) for r in c.execute("SELECT * FROM scans ORDER BY id DESC LIMIT 30")]
    c.close(); return jsonify(rows)

@app.get("/api/export")
def export():
    c=db(); rows=c.execute("SELECT created_at,target,ports,open_ports,duration FROM scans ORDER BY id DESC").fetchall(); c.close()
    b=io.StringIO(); w=csv.writer(b); w.writerow(["created_at","target","ports","open_ports","duration_seconds"]); w.writerows(rows)
    return Response(b.getvalue(),mimetype="text/csv",headers={"Content-Disposition":"attachment; filename=netscope_scans.csv"})

if __name__=="__main__":
    init_db(); app.run(host="127.0.0.1",port=5000,debug=False)
