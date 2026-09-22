# NetScope V3 Android / Termux

Android-friendly version. It removes psutil, which is not supported by standard Termux pip builds.

Run:
1. `pkg install python`
2. `pip install -r requirements.txt`
3. `python app.py`
4. Open http://127.0.0.1:5000

Packet capture can require elevated/root permissions on Android. The dashboard, ping and authorized TCP scanning can work without root.


## Mobile Data Analyzer
The dashboard now includes best-effort Android mobile-network information:
- Carrier/operator
- 2G/3G/4G/5G generation
- Network type
- DNS properties
- Public IP (requires internet access)
- SIM/data state
- Best-effort telephony signal information

Android/OEM restrictions can prevent signal-strength fields from being exposed.


## Network Speed Test
The dashboard includes a browser-based speed test with download, upload, latency, and jitter measurements. It uses public Cloudflare speed-test endpoints; results are approximate and can vary by network/server conditions.


### Upload speed
The speed test now performs a multi-chunk upload measurement and updates the upload value while the test is running.


## Speed test update
The browser speed test now uses roughly 10-second download and upload phases with live speed updates, rather than a single small transfer. Actual duration can vary with network conditions.


## Accuracy-focused speed test
The speed test uses a latency warm-up, multiple latency samples with a median, and four concurrent download/upload streams for approximately 15 seconds each. This reduces single-connection bottlenecks and short-test fluctuations. Results are still estimates because mobile radio conditions, server path, browser overhead, and carrier traffic can vary.
