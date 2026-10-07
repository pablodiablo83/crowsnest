# Probe 2: UK gauges in the IOC network, Millport history depth and datum, NTSLF published predictions (CI only).
import json, urllib.request, re
UA = {'User-Agent': 'CrowsNest/1.0 (private marine dashboard)'}
def get(u):
    try:
        r = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40); return r.status, r.read().decode('utf-8', 'replace')
    except Exception as e: return getattr(e, 'code', 0), str(e)
st, b = get('https://www.ioc-sealevelmonitoring.org/service.php?query=stationlist&showall=all')
L = json.loads(b)
print('country values sample:', sorted(set(str(s.get('country')) for s in L))[:200])
uk = [s for s in L if -11 < float(s.get('Lon') or s.get('lon') or 99) < 3 and 49 < float(s.get('Lat') or s.get('lat') or 0) < 61.5]
seen = set()
for s in sorted(uk, key=lambda s: -float(s.get('Lat') or s.get('lat'))):
    k = s.get('Code') or s.get('code')
    if k in seen: continue
    seen.add(k)
    print(f"{k:8} {str(s.get('Location'))[:28]:28} {s.get('country')} {s.get('Lat')},{s.get('Lon')} sensor={s.get('sensor')} rate={s.get('rate')} offset={s.get('offset')} first={s.get('first')} last={str(s.get('lasttime'))[:16]} status={s.get('status')}")
print('=== Millport full record ===')
for s in L:
    if (s.get('Code') or s.get('code')) == 'mill': print(s); break
print('=== Millport history depth ===')
for a, z in [('2025-10-01', '2025-10-03'), ('2024-10-01', '2024-10-03'), ('2020-01-01', '2020-01-03'), ('2025-09-01', '2025-10-31')]:
    st, b = get(f'https://www.ioc-sealevelmonitoring.org/service.php?query=data&code=mill&timestart={a}&timestop={z}&format=json')
    try: d = json.loads(b); print(a, z, st, len(d), 'points', d[0] if d else '', d[-1] if d else '', 'sensors', sorted(set(x['sensor'] for x in d)))
    except Exception: print(a, z, st, b[:200])
print('=== NTSLF predictions pages ===')
for u in ['https://ntslf.org/tides/predictions?port=Millport', 'https://ntslf.org/tides/tidepred?port=Millport', 'https://ntslf.org/tgi/portinfo?port=Millport', 'https://ntslf.org/tides/predictions']:
    st, b = get(u); t = re.sub(r'<[^>]+>', ' ', b); t = re.sub(r'\s+', ' ', t)
    i = t.find('Millport'); print(u, st, len(b), '|', t[max(0, i - 200):i + 1500] if i >= 0 else t[:400])
