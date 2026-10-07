# Probe open tide data sources from CI (the dev sandbox cannot reach them).
import json, urllib.request, datetime as dt
UA = {'User-Agent': 'CrowsNest/1.0 (private marine dashboard)'}
def get(u, n=None):
    try:
        r = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=30)
        b = r.read().decode('utf-8', 'replace'); return r.status, b
    except Exception as e:
        return getattr(e, 'code', 0), str(e)
print('=== IOC station list: UK / Ireland / Isle of Man / Channel Is ===')
st, b = get('https://www.ioc-sealevelmonitoring.org/service.php?query=stationlist&showall=all')
print('status', st, 'bytes', len(b))
try:
    L = json.loads(b); print('fields:', list(L[0].keys()))
    uk = [s for s in L if str(s.get('Country','')).upper() in ('GBR','IRL','IMN','JEY','GGY') or str(s.get('countryname','')).lower().find('united kingdom')>=0]
    for s in sorted(uk, key=lambda s: -float(s.get('Lat') or s.get('lat') or 0)):
        print({k: s.get(k) for k in s if k.lower() in ('code','location','lat','lon','country','sensor','sampling','status','lasttime','last')})
except Exception as e:
    print('parse fail', e, b[:500])
print('=== IOC data sample: Millport ===')
now = dt.datetime.utcnow(); t0 = (now - dt.timedelta(days=2)).strftime('%Y-%m-%d'); t1 = now.strftime('%Y-%m-%d')
for code in ['mill', 'mllp', 'millp', 'mlpt']:
    st, b = get(f'https://www.ioc-sealevelmonitoring.org/service.php?query=data&code={code}&timestart={t0}&timestop={t1}&format=json')
    print(code, st, len(b), b[:600].replace('\n',' '))
print('=== NOAA: harmonic constants + official predictions (San Francisco 9414290) ===')
st, b = get('https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9414290/harcon.json?units=metric')
print('harcon', st, b[:900])
st, b = get('https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=9414290&product=predictions&datum=MSL&interval=h&units=metric&time_zone=gmt&format=json&begin_date=20261001&end_date=20261002&application=crowsnest')
print('predictions', st, b[:500])
st, b = get('https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=9414290&product=predictions&datum=MSL&interval=hilo&units=metric&time_zone=gmt&format=json&begin_date=20261001&end_date=20261002&application=crowsnest')
print('hilo', st, b[:500])
print('=== UK sources ===')
for u in ['https://ntslf.org/data/uk-network-real-time', 'https://www.bodc.ac.uk/data/hosted_data_systems/sea_level/uk_tide_gauge_network/', 'https://environment.data.gov.uk/flood-monitoring/id/stations?type=TideGauge&_limit=3']:
    st, b = get(u); print(u, st, len(b), b[:300].replace('\n', ' '))
