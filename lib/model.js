"use strict";
/* CupEdge model: real-Elo Dixon-Coles + lineup-availability + motivation edges.
   Pure functions, no placeholders. Inputs come from data/elo.json, data/squads.json,
   and the live FIFA calendar feed (status, score, minute, tactics, published XI). */

const MAXG = 8;
const fact = [1,1,2,6,24,120,720,5040,40320];
const pois = (k, l) => Math.exp(-l) * Math.pow(l, k) / fact[k];

function dcTau(i, j, lh, la, rho) {
  if (i===0&&j===0) return 1 - lh*la*rho;
  if (i===0&&j===1) return 1 + lh*rho;
  if (i===1&&j===0) return 1 + la*rho;
  if (i===1&&j===1) return 1 - rho;
  return 1;
}
function eloToGoals(he, ae, homeAdv, total, slope) {
  total = total || 2.55; slope = slope || 0.40;
  const sup = ((he + homeAdv) - ae) / 100 * slope;
  return [Math.max(0.15, (total + sup)/2), Math.max(0.15, (total - sup)/2)];
}
function matrix(lh, la, rho) {
  rho = (rho==null) ? -0.05 : rho;
  const m = []; let s = 0;
  for (let i=0;i<=MAXG;i++){ m[i]=[]; for (let j=0;j<=MAXG;j++){ const v=pois(i,lh)*pois(j,la)*dcTau(i,j,lh,la,rho); m[i][j]=v; s+=v; } }
  for (let i=0;i<=MAXG;i++) for (let j=0;j<=MAXG;j++) m[i][j]/=s;
  return m;
}
function outcomes(m) {
  let h=0,d=0,a=0,o=0,b=0,bp=0,bi=0,bj=0;
  for (let i=0;i<=MAXG;i++) for (let j=0;j<=MAXG;j++){ const p=m[i][j];
    if (i>j) h+=p; else if (i<j) a+=p; else d+=p;
    if (i+j>=3) o+=p; if (i&&j) b+=p; if (p>bp){bp=p;bi=i;bj=j;} }
  return { home:h, draw:d, away:a, over25:o, btts:b, top:bi+"-"+bj };
}
/* In-play scoreline model. lateH/lateA = each side's REAL StatsBomb late-xG share (fraction of its
   shot xG struck at minute >= 80). In the closing phase we give a small COMEBACK nudge to the side
   that is NOT ahead, scaled by how late it is, how strong a late-scorer it is, and how much STRONGER
   that chasing side is than the leader (dElo = home effective-Elo minus away). A much stronger team
   that is trailing a weaker one presses harder and the weaker leader tends to tire/concede late, so
   the chasing nudge grows with the Elo gap in the chaser's favour. This makes "weak team protecting a
   lead vs a strong side" show as a weaker hold (fewer false leans) without hurting a strong favourite
   protecting a lead vs a weaker side (that opponent gets little/no extra nudge). Capped and gentle,
   only applied live - the pre-match price is untouched. Pass nulls/0 to disable (no bump). */
function inPlay(lh, la, minute, hs, as_, rho, lateH, lateA, dElo) {
  rho = (rho==null) ? -0.05 : rho;
  const rem = Math.max(0,(94-minute))/90;
  const base = 0.22, K = 1.0, CAP = 1.25;     // base = neutral late share; cap total comeback bump
  const G = 0.0012;                            // per-Elo "chasing intensity" for a stronger trailing side
  const dH = dElo || 0;                        // home effective-Elo minus away
  let bh = 1, ba = 1;
  if (minute >= 70) {
    const phase = Math.min(1, Math.max(0, (minute - 70) / 25));   // 0 at 70', ramps to 1 by ~95'
    const homeGap = Math.max(0, dH), awayGap = Math.max(0, -dH);  // each side's Elo edge over the other (>=0)
    const fh = Math.min(CAP, 1 + Math.max(0, (lateH||0) - base) * K * phase + homeGap * G * phase);
    const fa = Math.min(CAP, 1 + Math.max(0, (lateA||0) - base) * K * phase + awayGap * G * phase);
    if (hs <= as_) bh = fh;   // home trailing or level -> comeback nudge to its remaining xG
    if (as_ <= hs) ba = fa;   // away trailing or level -> comeback nudge
  }
  const m = matrix(lh*rem*bh, la*rem*ba, rho);
  let h=0,d=0,a=0;
  for (let i=0;i<=MAXG;i++) for (let j=0;j<=MAXG;j++){ const p=m[i][j]; const fh=hs+i, fa=as_+j;
    if (fh>fa) h+=p; else if (fh<fa) a+=p; else d+=p; }
  return { home:h, draw:d, away:a };
}

/* ---- EDGE 1: lineup availability. Real input = the published starting XI.
   For every KEY player NOT in the XI, subtract their eloImpact from that side. ---- */
function lineupAdjust(teamName, publishedXI, squads) {
  const roster = (squads && squads[teamName]) || [];
  if (!publishedXI || !publishedXI.length) {
    return { eloAdj: 0, status: "XI pending", missing: [] };
  }
  const inXI = new Set(publishedXI.map(s => String(s).toLowerCase()));
  const missing = roster.filter(p => {
    const last = p.n.split(/[ .]/).pop().toLowerCase();
    return ![...inXI].some(name => name.includes(last));
  });
  // cap the penalty: our reference squad can be older than the current one, so a player
  // who simply aged out shouldn't tank the team. Clamp the total downgrade to -35 Elo.
  const eloAdj = Math.max(-35, -missing.reduce((s,p)=>s+(p.eloImpact||0),0));
  return { eloAdj, status: missing.length ? "XI confirmed, key absences priced" : "XI confirmed, full strength",
           missing: missing.map(p=>p.n) };
}

/* ---- EDGE 2: motivation / dead rubber. Real input = group standings from finished matches.
   A side that has already clinched advancement or is eliminated before its final group game
   tends to rotate -> drop effective strength and widen the draw. ---- */
function motivationAdjust(teamName, standings) {
  const s = standings && standings[teamName];
  if (!s || s.played < 2) return { eloAdj: 0, drawBoost: 0, flag: null };
  // clinched: 6+ pts after 2 (or top of group with a gap); eliminated: 0 pts after 2
  if (s.points >= 6) return { eloAdj: -35, drawBoost: 0.03, flag: "clinched, rotation risk" };
  if (s.points === 0 && s.played >= 2) return { eloAdj: -25, drawBoost: 0.02, flag: "eliminated, low stakes" };
  return { eloAdj: 0, drawBoost: 0, flag: null };
}

/* ---- de-vig a price set (decimal odds) into fair probabilities ---- */
function devig(odds) {
  const r = { home:1/odds.home, draw:1/odds.draw, away:1/odds.away };
  const t = r.home + r.draw + r.away;
  return { home:r.home/t, draw:r.draw/t, away:r.away/t, vig: t-1 };
}

/* ---- full match evaluation ---- */
function evaluateMatch(opts) {
  // opts: homeName, awayName, homeElo, awayElo, homeAdv, total,
  //       live{minute,hs,as}, xiHome[], xiAway[], standings{}, squads{}, market{home,draw,away}
  const lineH = lineupAdjust(opts.homeName, opts.xiHome, opts.squads);
  const lineA = lineupAdjust(opts.awayName, opts.xiAway, opts.squads);
  const motH = motivationAdjust(opts.homeName, opts.standings);
  const motA = motivationAdjust(opts.awayName, opts.standings);

  const heAdj = opts.homeElo + lineH.eloAdj + motH.eloAdj;
  const aeAdj = opts.awayElo + lineA.eloAdj + motA.eloAdj;
  const [lh, la] = eloToGoals(heAdj, aeAdj, opts.homeAdv||0, opts.total||2.55);

  let probs, live = false;
  if (opts.live && opts.live.minute != null) {
    live = true;
    probs = inPlay(lh, la, opts.live.minute, opts.live.hs||0, opts.live.as||0, null, opts.lateHome, opts.lateAway, heAdj - aeAdj);
  } else {
    probs = outcomes(matrix(lh, la));
  }
  // draw widening from motivation
  const drawBoost = motH.drawBoost + motA.drawBoost;
  if (drawBoost > 0 && !live) {
    const add = drawBoost; const keep = 1 - add;
    probs = { home: probs.home*keep, draw: probs.draw + add*1, away: probs.away*keep,
              over25: probs.over25, btts: probs.btts, top: probs.top };
    const s = probs.home+probs.draw+probs.away; probs.home/=s; probs.draw/=s; probs.away/=s;
  }

  const out = { home: probs.home, draw: probs.draw, away: probs.away,
                over25: probs.over25, btts: probs.btts, top: probs.top, live,
                effectiveElo: { home: heAdj, away: aeAdj },
                edges: {
                  lineup: { home: lineH, away: lineA },
                  motivation: { home: motH.flag, away: motA.flag }
                } };

  if (opts.market && opts.market.home) {
    const fair = devig(opts.market);
    out.market = { fair, vig: fair.vig };
    out.legs = {};
    ["home","draw","away"].forEach(l => {
      const p = out[l], od = opts.market[l], b = od-1;
      out.legs[l] = { model:p, fair:fair[l], odds:od, ev: p*od-1, kelly: b>0?Math.max(0,(b*p-(1-p))/b):0 };
    });
  }
  return out;
}

module.exports = { eloToGoals, matrix, outcomes, inPlay, devig,
                   lineupAdjust, motivationAdjust, evaluateMatch };
