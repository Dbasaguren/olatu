import json, sys, numpy as np
from datetime import datetime, timezone, timedelta
C=json.load(open(sys.argv[1]))
EP=datetime(2000,1,1,tzinfo=timezone.utc)
def tide(h, withz=True):
    s=sum(a*np.cos(np.deg2rad(w*h-ph)) for n,w,a,ph in C["cons"] if 10<w<35)
    return s
def coefs(day0, ndays):
    h0=(day0-EP).total_seconds()/3600; h=np.arange(h0-12,h0+24*ndays+12,1/30); z=tide(h)
    ex=[(h[i],z[i],z[i]>z[i-1]) for i in range(1,len(z)-1) if (z[i]-z[i-1])*(z[i+1]-z[i])<=0 and z[i]!=z[i-1]]
    out=[]
    for i,(t,v,hi) in enumerate(ex):
        if not hi: continue
        lows=[e[1] for e in (ex[i-1:i]+ex[i+1:i+2]) if not e[2]]
        a=round(v/3.05*100); b=round((v-np.mean(lows))/6.10*100)
        d=EP+timedelta(hours=t)
        if d>=day0 and d<day0+timedelta(days=ndays): out.append((d.strftime("%Y-%m-%d %H:%M UTC"),a,b))
    return out
for d in [datetime(2015,3,20,tzinfo=timezone.utc), datetime(2015,9,28,tzinfo=timezone.utc)]:
    for r in coefs(d,3): print("PM %s  coef(PM-N0)/U=%d  coef(marnage)=%d"%r)
