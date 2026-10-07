# Prints the structure of the Met Office inshore waters pages/feeds (run in CI: the dev sandbox cannot reach the Met Office).
import re, sys, urllib.request, html
URLS = [
  'https://weather.metoffice.gov.uk/specialist-forecasts/coast-and-sea/print/inshore-waters-forecast',
  'https://weather.metoffice.gov.uk/specialist-forecasts/coast-and-sea/inshore-waters-forecast',
  'https://www.metoffice.gov.uk/public/data/CoreProductCache/InshoreWatersForecast/Latest',
  'https://www.metoffice.gov.uk/public/data/CoreProductCache/InshoreWaters/Latest',
  'https://www.metoffice.gov.uk/public/data/CoreProductCache/ShippingForecast/Latest',
]
UA = {'User-Agent': 'Mozilla/5.0 (CrowsNest personal marine dashboard)'}
def get(u):
  try:
    r = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=20)
    return r.status, r.headers.get('Content-Type'), r.geturl(), r.read().decode('utf-8', 'replace')
  except Exception as e:
    return getattr(e, 'code', 0), None, u, str(e)
for u in URLS:
  st, ct, final, body = get(u)
  print('=' * 100); print(u); print('status', st, '| type', ct, '| final', final, '| bytes', len(body))
  if st != 200: print(body[:200]); continue
  if 'xml' in (ct or '') or body.lstrip().startswith('<?xml'):
    print(body[:2500]); continue
  ids = re.findall(r'<(\w+)[^>]*\sid="([^"]+)"', body)
  print('ids:', [f'{t}#{i}' for t, i in ids][:120])
  for h in re.findall(r'<(h[1-4])[^>]*>(.*?)</\1>', body, re.S)[:80]:
    print(h[0], '|', re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', h[1]))).strip()[:120])
  print('data-/class sample:', sorted(set(re.findall(r'class="([^"]+)"', body)))[:150])
  print('feeds:', sorted(set(re.findall(r'["\'](https?://[^"\']+?\.(?:json|xml)[^"\']*)["\']', body)))[:20])
  # one area's full markup, so the parser can be written against the real thing
  m = re.search(r'(Mull of Galloway to Mull of Kintyre.{0,6000})', body, re.S)
  if m: print('--- CLYDE AREA RAW ---'); print(m.group(1)[:6000])
  m = re.search(r'(Issued.{0,400})', body, re.S)
  if m: print('--- ISSUED ---', re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', m.group(1)))[:300])
