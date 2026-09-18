/* 2026 PPR draft board (12-team ADP, mock-draft consensus) — offline fallback only */
import { getNflPlayers, getNflPlayersAt, fantasyBoardFromLive } from "../sleeper.js";

const PLAYERS = [
  ["Jahmyr Gibbs","RB","DET",6,1.6],["Bijan Robinson","RB","ATL",11,1.9],["Puka Nacua","WR","LAR",11,3.1],
  ["Ja'Marr Chase","WR","CIN",6,3.9],["Jaxon Smith-Njigba","WR","SEA",11,5.4],["Amon-Ra St. Brown","WR","DET",6,6.3],
  ["Christian McCaffrey","RB","SF",8,6.6],["Jonathan Taylor","RB","IND",13,7.5],["Drake London","WR","ATL",11,9.9],
  ["De'Von Achane","RB","MIA",6,10.4],["CeeDee Lamb","WR","DAL",14,10.6],["Justin Jefferson","WR","MIN",6,11.7],
  ["James Cook III","RB","BUF",7,12.7],["Chase Brown","RB","CIN",6,13.4],["Rashee Rice","WR","KC",5,14.8],
  ["Ashton Jeanty","RB","LV",13,15.1],["Derrick Henry","RB","BAL",13,17.6],["A.J. Brown","WR","NE",11,18.2],
  ["Saquon Barkley","RB","PHI",10,19.7],["George Pickens","WR","DAL",14,19.8],["Chris Olave","WR","NO",8,20.2],
  ["Nico Collins","WR","HOU",8,21.2],["Kenneth Walker","RB","KC",5,22.2],["Omarion Hampton","RB","LAC",7,23.2],
  ["Zay Flowers","WR","BAL",13,25.2],["Garrett Wilson","WR","NYJ",13,26.1],["Malik Nabers","WR","NYG",8,27.3],
  ["Jeremiyah Love","RB","ARI",14,27.9],["Trey McBride","TE","ARI",14,28.8],["DeVonta Smith","WR","PHI",10,29.6],
  ["Josh Jacobs","RB","GB",11,30.9],["Kyren Williams","RB","LAR",11,31.5],["Tetairoa McMillan","WR","CAR",5,32.9],
  ["Josh Allen","QB","BUF",7,33.7],["Breece Hall","RB","NYJ",13,34.6],["Emeka Egbuka","WR","TB",10,35.2],
  ["Brock Bowers","TE","LV",13,35.5],["Tee Higgins","WR","CIN",6,36.2],["Cam Skattebo","RB","NYG",8,36.4],
  ["Javonte Williams","RB","DAL",14,36.7],["Ladd McConkey","WR","LAC",7,37.7],["Travis Etienne Jr.","RB","NO",8,40.7],
  ["Davante Adams","WR","LAR",11,41.8],["Jameson Williams","WR","DET",6,44.0],["Bucky Irving","RB","TB",10,45.3],
  ["D'Andre Swift","RB","CHI",10,45.8],["Jaylen Waddle","WR","DEN",10,46.0],["Terry McLaurin","WR","WAS",7,46.7],
  ["DJ Moore","WR","BUF",7,48.9],["Quinshon Judkins","RB","CLE",11,50.9],["Rome Odunze","WR","CHI",10,51.4],
  ["Drake Maye","QB","NE",11,51.6],["Bhayshul Tuten","RB","JAX",7,52.9],["Mike Evans","WR","SF",8,53.6],
  ["Colston Loveland","TE","CHI",10,56.5],["Lamar Jackson","QB","BAL",13,56.7],["Joe Burrow","QB","CIN",6,57.4],
  ["David Montgomery","RB","HOU",8,58.4],["Christian Watson","WR","GB",11,58.7],["Jaylen Warren","RB","PIT",9,59.0],
  ["Luther Burden III","WR","CHI",10,59.3],["Courtland Sutton","WR","DEN",10,60.3],["TreVeyon Henderson","RB","NE",11,60.7],
  ["Alec Pierce","WR","IND",13,63.2],["Parker Washington","WR","JAX",7,64.7],["DK Metcalf","WR","PIT",9,64.8],
  ["Tyler Warren","TE","IND",13,64.9],["Dak Prescott","QB","DAL",14,65.3],["Marvin Harrison Jr.","WR","ARI",14,66.1],
  ["Tony Pollard","RB","TEN",9,68.4],["Rhamondre Stevenson","RB","NE",11,68.9],["Jayden Daniels","QB","WAS",7,71.9],
  ["Brian Thomas Jr.","WR","JAX",7,72.1],["Michael Pittman Jr.","WR","PIT",9,74.6],["Rico Dowdle","RB","PIT",9,74.9],
  ["Carnell Tate","WR","TEN",9,75.5],["Kyle Pitts Sr.","TE","ATL",11,75.9],["Michael Wilson","WR","ARI",14,76.3],
  ["Matthew Stafford","QB","LAR",11,77.2],["Chuba Hubbard","RB","CAR",5,78.5],["Harold Fannin Jr.","TE","CLE",11,78.6],
  ["Jadarian Price","RB","SEA",11,79.1],["Jalen Hurts","QB","PHI",10,79.7],["Chris Godwin Jr.","WR","TB",10,80.4],
  ["Josh Downs","WR","IND",13,83.9],["Wan'Dale Robinson","WR","TEN",9,86.0],["RJ Harvey","RB","DEN",10,86.0],
  ["Brock Purdy","QB","SF",8,88.4],["Jakobi Meyers","WR","JAX",7,88.5],["Caleb Williams","QB","CHI",10,89.3],
  ["Kenny Gainwell","RB","TB",10,91.0],["Stefon Diggs","WR","WAS",7,91.2],["J.K. Dobbins","RB","DEN",10,91.5],
  ["Trevor Lawrence","QB","JAX",7,92.2],["Jayden Reed","WR","GB",11,94.3],["Quentin Johnston","WR","LAC",7,94.7],
  ["Sam LaPorta","TE","DET",6,96.0],["Jordan Addison","WR","MIN",6,97.8],["Jared Goff","QB","DET",6,99.7],
  ["Khalil Shakir","WR","BUF",7,100.7],["Aaron Jones Sr.","RB","MIN",6,101.6],["Patrick Mahomes","QB","KC",5,101.9],
  ["Tucker Kraft","TE","GB",11,102.0],["Justin Herbert","QB","LAC",7,105.8],["Matthew Golden","WR","GB",11,105.9],
  ["Xavier Worthy","WR","KC",5,106.3],["Travis Kelce","TE","KC",5,109.0],["Bo Nix","QB","DEN",10,112.7],
  ["George Kittle","TE","SF",8,117.9],["Seattle","DEF","SEA",11,82.9],["Denver","DEF","DEN",10,88.4],
  ["Houston","DEF","HOU",8,97.3],["Brandon Aubrey","PK","DAL",14,130.0],
].map(([name, pos, team, bye, adp], i) => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  name, pos, team, bye, adp,
  round: Math.max(1, Math.ceil(adp / 12)),
}));
const TEAM_BYE = {}; PLAYERS.forEach((p) => { if (p.team && p.bye) TEAM_BYE[p.team] = p.bye; });

function tierOf(adp) {
  if (adp <= 5) return "Tier 1 · elite anchors";
  if (adp <= 12) return "Tier 2 · round 1";
  if (adp <= 24) return "Tier 3 · round 2";
  if (adp <= 36) return "Tier 4 · rounds 3–4";
  if (adp <= 60) return "Tier 5 · rounds 5–6";
  if (adp <= 84) return "Tier 6 · rounds 7–8";
  if (adp <= 120) return "Tier 7 · rounds 9–11";
  return "Tier 8 · late / stash";
}

export { PLAYERS, TEAM_BYE, tierOf, staticFantasyBoard, loadFantasyBoard };

/** Offline fallback board shaped like fantasyBoardFromLive (uses preseason ADP). */
function staticFantasyBoard(limit = 200) {
  const rows = PLAYERS.map((p) => ({
    id: p.id,
    player_id: p.id,
    name: p.name,
    pos: p.pos,
    team: p.team || "",
    bye: p.bye != null ? p.bye : null,
    adp: p.adp,
    rank: p.adp,
    source: "static",
  })).sort((a, b) => a.adp - b.adp || a.name.localeCompare(b.name));
  return limit > 0 ? rows.slice(0, limit) : rows;
}

/**
 * Prefer live Sleeper search_rank board; fall back to static PLAYERS ADP.
 * Reuses the session-cached getNflPlayers loader.
 */
async function loadFantasyBoard({ force = false, limit = 200 } = {}) {
  try {
    const pool = await getNflPlayers({ force });
    const board = fantasyBoardFromLive(pool, limit);
    if (board.length) {
      return { board, at: getNflPlayersAt(), source: "live" };
    }
  } catch { /* fall through */ }
  return { board: staticFantasyBoard(limit), at: null, source: "static" };
}
