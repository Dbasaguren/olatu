// Temps : heures locales « naïves » (heure de Paris) traitées en UTC pour éviter les soucis de changement d'heure.

export const TZ = "Europe/Paris";
export const H = 3600e3;
export const tp = s => Date.UTC(+s.slice(0,4), +s.slice(5,7)-1, +s.slice(8,10), +s.slice(11,13)||0, +s.slice(14,16)||0);
export const nowNaive = () => { const p = new Intl.DateTimeFormat("sv-SE",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date()); return tp(p.replace(" ","T")); };
export const hhmm = ms => { const d=new Date(ms); return String(d.getUTCHours()).padStart(2,"0")+":"+String(d.getUTCMinutes()).padStart(2,"0"); };
export const dayKey = ms => new Date(ms).toISOString().slice(0,10);
export const DAYS = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
export const CARD = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSO","SO","OSO","O","ONO","NO","NNO"];
export const card = d => CARD[Math.round(((d%360)+360)%360/22.5)%16];
export const PARIS = new Intl.DateTimeFormat("sv-SE",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
export const toNaive = utc => { const s = PARIS.format(new Date(utc)); return tp(s.replace(" ","T")) + (+s.slice(17,19)||0)*1000; };
