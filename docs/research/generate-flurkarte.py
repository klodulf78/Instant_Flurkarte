import subprocess, json, time, urllib.parse

def curl(args, data=None):
    return subprocess.run(["curl","-s","--max-time","40"]+args, input=data,
                          stdout=subprocess.PIPE).stdout

# 1) Geocode (Nominatim) via curl
q = urllib.parse.urlencode({"q":"Gosenstraße, 32479 Hille","format":"json","limit":3,
                            "countrycodes":"de","addressdetails":1})
geo = json.loads(curl(["-H","User-Agent: InstantFlurkarte/0.1 (hackathon demo)",
                       "https://nominatim.openstreetmap.org/search?"+q]) or b"[]")
print("geocode hits:", len(geo))
if not geo: raise SystemExit("address not found")
lat=float(geo[0]["lat"]); lon=float(geo[0]["lon"])
print("lon/lat:", round(lon,5), round(lat,5), "|", geo[0].get("display_name","")[:75])

# 2) OGC API parcels near point, geometry EPSG:25832
d=0.0012
o=urllib.parse.urlencode({"bbox":f"{lon-d},{lat-d},{lon+d},{lat+d}","limit":20,
   "crs":"http://www.opengis.net/def/crs/EPSG/0/25832","f":"json"})
fc=json.loads(curl(["https://ogc-api.nrw.de/lika/v1/collections/flurstueck/items?"+o]) or b"{}")
feats=fc.get("features",[]); print("parcels near point:", len(feats))
if not feats: raise SystemExit("no parcels")
xs=[];ys=[]
def walk(c):
    if c and isinstance(c[0],(int,float)): xs.append(c[0]);ys.append(c[1]);return
    for x in c: walk(x)
for f in feats: walk(f["geometry"]["coordinates"])
minx,miny,maxx,maxy=min(xs),min(ys),max(xs),max(ys)
cx=(minx+maxx)/2; cy=(miny+maxy)/2; maxdim=max(maxx-minx,maxy-miny)
p0=feats[0]["properties"]
print("nearest parcel:", p0.get("gemarkung"),"Flur",p0.get("flur"),"Flst",p0.get("flstnrzae"),"| Lage:",p0.get("lagebeztxt"))
print("maxdim m:", round(maxdim), "| center:", round(cx),round(cy))
scale = 500 if maxdim<60 else (1000 if maxdim<150 else 2000)
print("scale 1:%d"%scale)

# 3) MapFish print
alkis={"type":"wms","baseURL":"https://www.wms.nrw.de/geobasis/wms_nw_alkis",
 "layers":["adv_alkis_flurstuecke","adv_alkis_gebaeude","adv_alkis_tatsaechliche_nutzung"],
 "imageFormat":"image/png","customParams":{"TRANSPARENT":"true"},"version":"1.3.0"}
spec={"layout":"A4 portrait nc","outputFormat":"pdf","outputFilename":"Gosenstrasse 32479 Hille",
 "attributes":{"title":"Flurkarte_Gosenstraße 32479 Hille","comment":"","scale":str(scale),
  "datasource":[{"table":{"columns":["url","layer","fees","accessConstraints"],
    "data":[["https://www.wms.nrw.de/geobasis/wms_nw_alkis","ALKIS","Datenlizenz Deutschland Zero","Datenlizenz Deutschland Zero"]]}}],
  "map":{"projection":"EPSG:25832","dpi":127,"rotation":0,"center":[cx,cy],"scale":scale,"layers":[alkis]},
  "overviewMap":{"projection":"EPSG:25832","dpi":127,"rotation":0,"bbox":[288300,5551800,524700,5842200],
   "layers":[{"type":"wms","baseURL":"https://www.wms.nrw.de/geobasis/wms_nw_nrw_uebersicht",
    "layers":["nw_nrw_uebersicht_5000_utm32"],"imageFormat":"image/png","version":"1.3.0"}]}}}
BASE="https://www.tim-online.nrw.de/mapfish-print/print"
resp=json.loads(curl(["-X","POST",BASE+"/timonline_templates/report.pdf","-H","Content-Type: application/json","--data-binary","@-"],
                     data=json.dumps(spec).encode()) or b"{}")
ref=resp["ref"]
for i in range(30):
    st=json.loads(curl([BASE+"/status/"+ref+".json"]) or b"{}")
    if st.get("done"): print("status:", st.get("status")); break
    time.sleep(1.2)
pdf=curl([BASE+"/report/"+ref])
open("/tmp/flurkarte_hille.pdf","wb").write(pdf)
print("PDF bytes:", len(pdf), "| %PDF:", pdf[:4]==b"%PDF")
