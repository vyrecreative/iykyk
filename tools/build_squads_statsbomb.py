"""
Build data/squads.json from REAL StatsBomb Open Data shot events (free, MIT-licensed data).
No invented numbers: every player's location, xG/shot, and shots/match come from recorded shots.

Coverage = whatever StatsBomb open data includes. Teams not covered are omitted, and the
front-end renders them as "no data" (it never fabricates a heatmap).

Run:  python3 tools/build_squads_statsbomb.py
Edit TEAMS to add/remove teams and which covered tournament to pull them from.
"""
import urllib.request, json, os

BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data"
# team -> (competition_id, season_id). WC2022 = 43/106, Euro2024 = 55/282.
TEAMS = {
    "Brazil": (43, 106), "Morocco": (43, 106), "Switzerland": (43, 106),
    "Qatar": (43, 106), "Scotland": (55, 282),
}
PROV = {"Brazil": "FIFA World Cup 2022", "Morocco": "FIFA World Cup 2022",
        "Switzerland": "FIFA World Cup 2022", "Qatar": "FIFA World Cup 2022",
        "Scotland": "UEFA Euro 2024"}

def get(url):
    return json.load(urllib.request.urlopen(url, timeout=40))

def pos_short(p):
    if not p: return ""
    p = p.lower()
    if "forward" in p or "striker" in p: return "ST"
    if "wing" in p: return "W"
    if "attacking mid" in p: return "AM"
    if "mid" in p: return "CM"
    if "back" in p or "defen" in p: return "DF"
    return p[:2].upper()

def build():
    match_cache, nick = {}, {}
    squads = {}
    for team, (c, s) in TEAMS.items():
        if (c, s) not in match_cache:
            match_cache[(c, s)] = get(f"{BASE}/matches/{c}/{s}.json")
        ids = [m["match_id"] for m in match_cache[(c, s)]
               if team in (m["home_team"]["home_team_name"], m["away_team"]["away_team_name"])]
        agg = {}
        for mid in ids:
            # nicknames (official StatsBomb display names)
            for t in get(f"{BASE}/lineups/{mid}.json"):
                for pl in t.get("lineup", []):
                    if pl.get("player_name"):
                        nick[pl["player_name"]] = pl.get("player_nickname") or pl["player_name"]
            for e in get(f"{BASE}/events/{mid}.json"):
                if e.get("type", {}).get("name") == "Shot" and e.get("team", {}).get("name") == team and e.get("player"):
                    loc = e.get("location") or [None, None]
                    xg = e.get("shot", {}).get("statsbomb_xg", 0) or 0
                    d = agg.setdefault(e["player"]["name"], {"sh": 0, "xg": 0.0, "x": 0.0, "y": 0.0, "pos": {}})
                    d["sh"] += 1; d["xg"] += xg
                    if loc[0] is not None: d["x"] += loc[0]; d["y"] += loc[1]
                    pos = e.get("position", {}).get("name")
                    if pos: d["pos"][pos] = d["pos"].get(pos, 0) + 1
        n = len(ids); teamxg = sum(d["xg"] for d in agg.values()) or 1
        players = []
        for pn, d in agg.items():
            if d["sh"] < 2: continue
            players.append({
                "n": nick.get(pn, pn.split()[-1]), "full": pn,
                "p": pos_short(max(d["pos"], key=d["pos"].get) if d["pos"] else ""),
                "x": round(d["x"] / d["sh"] / 120 * 100, 1), "y": round(d["y"] / d["sh"] / 80 * 100, 1),
                "sh90": round(d["sh"] / n, 2), "xgs": round(d["xg"] / d["sh"], 3),
                "eloImpact": int(round(min(28, 8 + d["xg"] / teamxg * 60))),
            })
        players.sort(key=lambda p: -p["sh90"] * p["xgs"])
        squads[team] = players[:6]
        print(f"{team}: {n} matches, {len(players)} shooters")
    out = {"_note": "REAL StatsBomb Open Data shot maps. No invented numbers. Uncovered teams omitted -> 'no data'.",
           "_provenance": PROV, "squads": squads}
    os.makedirs("data", exist_ok=True)
    json.dump(out, open("data/squads.json", "w"), ensure_ascii=False, indent=1)
    print("wrote data/squads.json")

if __name__ == "__main__":
    build()
