import { getSupabase } from "./supabase.js";

const $ = (selector) => document.querySelector(selector);
const exportButton = $("#export-results-document");
const resetDialog = $("#reset-database-dialog");
const resetInput = $("#reset-confirmation-text");
const resetButton = $("#confirm-reset-database");
const resetMessage = $("#reset-database-message");

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function formatDate(value, style = "medium") {
  if (!value) return "Data não informada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data não informada";
  return new Intl.DateTimeFormat("pt-BR", style === "long"
    ? { dateStyle: "long" }
    : { day: "2-digit", month: "short", year: "numeric" }).format(date).replace(/ de /g, " ");
}

function statusLabel(status) {
  return ({
    completed: "Finalizado",
    in_progress: "Ao vivo",
    pending: "Aguardando",
    bye: "Avanço automático"
  })[status] || "Aguardando";
}

function roundLabel(index, total) {
  const distanceToFinal = total - index - 1;
  if (distanceToFinal === 0) return "Final";
  if (distanceToFinal === 1) return "Semifinal";
  if (distanceToFinal === 2) return "Quartas de final";
  if (distanceToFinal === 3) return "Oitavas de final";
  return `${index + 1}ª rodada`;
}

function getSide(match, side) {
  const id = match[`${side}_team_id`];
  return {
    id: id == null ? "" : String(id),
    name: match[`${side}_team_name`] || (id ? "Competidor não identificado" : "A definir"),
    classroom: match[`${side}_classroom`] || "",
    score: match[`${side}_score`],
    winner: Boolean(match.winner_team_id && id && String(match.winner_team_id) === String(id))
  };
}

function renderTeamLine(side) {
  const name = safeText(side.name);
  const classroom = side.classroom ? `<small>${safeText(side.classroom)}</small>` : "";
  const score = side.score === null || side.score === undefined ? "–" : safeText(side.score);
  return `<div class="report-team ${side.winner ? "is-winner" : ""}">
    <span class="report-team__identity"><strong>${name}</strong>${classroom}</span>
    <span class="report-team__score">${score}</span>
    ${side.winner ? '<span class="report-team__winner">VENCEU</span>' : ""}
  </div>`;
}

function renderCompactMatch(match) {
  const home = getSide(match, "home");
  const away = getSide(match, "away");
  const statusClass = match.status === "completed" ? "is-done" : match.status === "in_progress" ? "is-live" : match.status === "bye" ? "is-bye" : "is-pending";
  const groupOrGame = match.group_name ? `${match.group_name} · Jogo ${match.match_number}` : `Jogo ${match.match_number}`;
  return `<article class="group-match ${statusClass}">
    <header><span>${safeText(groupOrGame)}</span><b>${safeText(statusLabel(match.status))}</b></header>
    ${renderTeamLine(home)}
    ${renderTeamLine(away)}
  </article>`;
}

function renderGroupStage(matches) {
  if (!matches.length) return "";
  const groups = new Map();
  matches.forEach((match) => {
    const groupName = match.group_name || "Grupo único";
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName).push(match);
  });
  const groupsHtml = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR", { numeric: true }))
    .map(([name, groupMatches]) => {
      const sorted = [...groupMatches].sort((a, b) => Number(a.match_number || 0) - Number(b.match_number || 0));
      const done = sorted.filter((match) => match.status === "completed").length;
      return `<article class="group-report-card">
        <header class="group-report-card__header"><div><span class="eyebrow-small">FASE CLASSIFICATÓRIA</span><h4>${safeText(name)}</h4></div><span class="group-progress">${done}/${sorted.length} resultados</span></header>
        <div class="group-match-list">${sorted.map(renderCompactMatch).join("")}</div>
      </article>`;
    }).join("");
  return `<section class="report-phase report-group-phase">
    <div class="phase-heading"><span class="phase-index">01</span><div><span class="eyebrow-small">PRIMEIRA ETAPA</span><h3>Fase de grupos</h3><p>Confrontos e resultados registrados em cada grupo.</p></div></div>
    <div class="group-report-grid">${groupsHtml}</div>
  </section>`;
}

function renderKnockoutBracket(matches) {
  if (!matches.length) return `<div class="bracket-pending"><span class="bracket-pending__icon">⌛</span><div><strong>Chave eliminatória ainda não gerada</strong><p>Quando a fase de grupos terminar, a organização poderá gerar os confrontos que definirão o campeão.</p></div></div>`;

  const grouped = new Map();
  matches.forEach((match) => {
    const round = Number(match.round_number) || 1;
    if (!grouped.has(round)) grouped.set(round, []);
    grouped.get(round).push(match);
  });
  const rounds = [...grouped.entries()].sort(([a], [b]) => a - b).map(([number, roundMatches]) => ({
    number,
    matches: [...roundMatches].sort((a, b) => Number(a.match_number || 0) - Number(b.match_number || 0))
  }));

  const CARD_W = 218;
  const CARD_H = 112;
  const COL_GAP = 62;
  const ROW_H = 138;
  const firstRoundCount = Math.max(1, rounds[0]?.matches.length || 1);
  const totalHeight = firstRoundCount * ROW_H;
  const totalWidth = rounds.length * CARD_W + Math.max(0, rounds.length - 1) * COL_GAP;
  const colStep = CARD_W + COL_GAP;
  const centerY = (roundIndex, matchIndex) => ((matchIndex * (2 ** roundIndex)) + (2 ** (roundIndex - 1))) * ROW_H;

  let paths = "";
  for (let roundIndex = 0; roundIndex < rounds.length - 1; roundIndex += 1) {
    const current = rounds[roundIndex].matches;
    const next = rounds[roundIndex + 1].matches;
    next.forEach((target, targetIndex) => {
      [targetIndex * 2, targetIndex * 2 + 1].forEach((sourceIndex) => {
        if (!current[sourceIndex]) return;
        const x1 = roundIndex * colStep + CARD_W;
        const x2 = (roundIndex + 1) * colStep;
        const middle = x1 + (x2 - x1) / 2;
        const y1 = centerY(roundIndex, sourceIndex);
        const y2 = centerY(roundIndex + 1, targetIndex);
        paths += `<path fill="none" stroke="#c9bea6" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" d="M ${x1} ${y1} H ${middle} V ${y2} H ${x2}"/>`;
      });
    });
  }

  const columnHeadings = rounds.map((round, index) => `<div class="bracket-round-heading ${index === rounds.length - 1 ? "is-final" : ""}" style="width:${CARD_W}px">
    <span>${String(index + 1).padStart(2, "0")}</span><strong>${safeText(roundLabel(index, rounds.length))}</strong>
  </div>`).join("");

  const cards = rounds.map((round, roundIndex) => round.matches.map((match, matchIndex) => {
    const home = getSide(match, "home");
    const away = getSide(match, "away");
    const top = centerY(roundIndex, matchIndex) - CARD_H / 2;
    const left = roundIndex * colStep;
    const statusClass = match.status === "completed" ? "is-done" : match.status === "in_progress" ? "is-live" : match.status === "bye" ? "is-bye" : "is-pending";
    const finalClass = roundIndex === rounds.length - 1 ? "is-final-match" : "";
    return `<article class="bracket-match ${statusClass} ${finalClass}" style="left:${left}px;top:${top}px;width:${CARD_W}px;height:${CARD_H}px">
      <header><span>CONFRONTO</span><b>JOGO ${String(match.match_number || matchIndex + 1).padStart(2, "0")}</b></header>
      ${renderTeamLine(home)}
      ${renderTeamLine(away)}
      <footer><span class="match-status-dot"></span>${safeText(statusLabel(match.status))}</footer>
    </article>`;
  }).join("")).join("");

  const printScale = Math.min(1, 1060 / totalWidth, 940 / totalHeight);
  const printHeight = Math.ceil(totalHeight * printScale);
  return `<section class="report-phase report-knockout-phase">
    <div class="phase-heading"><span class="phase-index">02</span><div><span class="eyebrow-small">CAMINHO ATÉ O TÍTULO</span><h3>Chave eliminatória</h3><p>Cada linha mostra o avanço dos vencedores até a decisão final.</p></div></div>
    <div class="bracket-legend"><span><i class="legend-dot legend-dot--done"></i>Resultado definido</span><span><i class="legend-dot legend-dot--live"></i>Ao vivo</span><span><i class="legend-dot legend-dot--pending"></i>Aguardando jogo</span></div>
    <div class="bracket-round-headings" style="width:${totalWidth}px;gap:${COL_GAP}px">${columnHeadings}</div>
    <div class="bracket-viewport" style="height:${totalHeight}px;--print-scale:${printScale};--print-height:${printHeight}px">
      <div class="bracket-canvas" style="width:${totalWidth}px;height:${totalHeight}px">
        <svg class="bracket-connectors" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}" aria-hidden="true">${paths}</svg>
        ${cards}
      </div>
    </div>
  </section>`;
}

function renderTournament(tournament, index) {
  const matches = Array.isArray(tournament.matches) ? tournament.matches : [];
  const groupMatches = matches.filter((match) => match.phase === "groups");
  const knockoutMatches = matches.filter((match) => match.phase === "knockout");
  const completed = matches.filter((match) => match.status === "completed").length;
  const live = matches.filter((match) => match.status === "in_progress").length;
  const date = formatDate(tournament.created_at);
  const format = tournament.format === "groups" ? "Fase de grupos + mata-mata" : "Mata-mata direto";
  const status = tournament.status === "completed" ? "Campeonato concluído" : tournament.status === "groups" ? "Fase de grupos" : "Em andamento";
  const winner = tournament.winner_team_name ? `<div class="champion-panel">
    <div class="champion-panel__cup">🏆</div><div><span>CAMPEÃO(Ã)</span><strong>${safeText(tournament.winner_team_name)}</strong><small>${safeText(tournament.winner_classroom || "Classificação não informada")}</small></div><div class="champion-panel__stamp">1º<br> LUGAR</div>
  </div>` : "";
  const groupHtml = groupMatches.length ? renderGroupStage(groupMatches) : "";
  const bracketTitle = tournament.format === "groups" ? "MATA-MATA FINAL" : "ELIMINATÓRIAS";
  const knockoutHtml = `<div class="bracket-label">${safeText(bracketTitle)}</div>${renderKnockoutBracket(knockoutMatches)}`;
  return `<article class="report-tournament">
    <header class="report-tournament__header"><div class="tournament-number">${String(index + 1).padStart(2, "0")}</div><div class="report-tournament__identity"><span class="eyebrow-small">MODALIDADE · ${safeText(format)}</span><h2>${safeText(tournament.modality_name || "Modalidade")}</h2><p>${matches.length} jogos · ${completed} finalizados${live ? ` · ${live} ao vivo` : ""} · Sorteio em ${safeText(date)}</p></div><span class="tournament-state ${tournament.status === "completed" ? "is-complete" : ""}">${safeText(status)}</span></header>
    ${winner}
    ${groupHtml}
    ${knockoutHtml}
    <footer class="report-tournament__footer"><span>JOGOS · GAVIÃO PEIXOTO</span><span>${completed}/${matches.length} resultados registrados</span></footer>
  </article>`;
}

function renderTeamRoster(team) {
  const people = Array.isArray(team.team_members) ? team.team_members : [];
  const names = people.length
    ? people.map((person) => `<span class="roster-person ${person.is_banned ? "is-banned" : ""}">${safeText(person.name)}${person.is_banned ? " · BANIDO" : ""}</span>`).join("")
    : '<span class="roster-person">Sem participantes informados</span>';
  return `<tr class="${team.is_banned ? "is-banned" : ""}">
    <td><strong>${safeText(team.name)}</strong>${team.is_banned ? '<span class="ban-tag">EQUIPE BANIDA</span>' : ""}</td>
    <td>${safeText(team.modality_name)}</td><td>${safeText(team.classroom || "—")}</td><td><div class="roster-list">${names}</div></td><td>${safeText(formatDate(team.created_at))}</td>
  </tr>`;
}

async function loadCrestDataUrl() {
  try {
    const response = await fetch(new URL("../assets/brasao-escola.png", import.meta.url));
    if (!response.ok) return "";
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
  } catch (_) {
    return "";
  }
}

function buildReport(snapshot, crestDataUrl) {
  const teams = Array.isArray(snapshot.teams) ? snapshot.teams : [];
  const modalities = Array.isArray(snapshot.modalities) ? snapshot.modalities : [];
  const tournaments = Array.isArray(snapshot.tournaments) ? snapshot.tournaments : [];
  const allMatches = tournaments.flatMap((tournament) => tournament.matches || []);
  const completedMatches = allMatches.filter((match) => match.status === "completed").length;
  const liveMatches = allMatches.filter((match) => match.status === "in_progress").length;
  const participantCount = teams.reduce((total, team) => total + (team.team_members || []).length, 0);
  const champions = tournaments.filter((tournament) => tournament.status === "completed" && tournament.winner_team_name);
  const today = formatDate(new Date(), "long");
  const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date());
  const stats = [
    { label: "Inscrições", value: teams.length, note: "Equipes e competidores" },
    { label: "Modalidades", value: modalities.length, note: "Disputas cadastradas" },
    { label: "Participantes", value: participantCount, note: "Pessoas inscritas" },
    { label: "Jogos concluídos", value: completedMatches, note: `De ${allMatches.length} confrontos` }
  ];
  const statCards = stats.map((stat, index) => `<article class="summary-stat summary-stat--${index + 1}"><span>${safeText(stat.label)}</span><strong>${safeText(stat.value)}</strong><small>${safeText(stat.note)}</small></article>`).join("");
  const championsHtml = champions.length ? `<section class="champions-overview"><div class="section-kicker">PÓDIO DOS JOGOS</div><div class="champions-grid">${champions.map((tournament) => `<article class="champion-mini"><span>🏆</span><div><small>${safeText(tournament.modality_name)}</small><strong>${safeText(tournament.winner_team_name)}</strong><em>${safeText(tournament.winner_classroom || "Campeão")}</em></div></article>`).join("")}</div></section>` : "";
  const tournamentsHtml = tournaments.length
    ? tournaments.map(renderTournament).join("")
    : '<div class="empty-report"><span>⚑</span><strong>Nenhum sorteio foi gerado.</strong><p>Assim que as modalidades forem sorteadas, as chaves e os resultados aparecerão neste documento.</p></div>';
  const sortedTeams = [...teams].sort((a, b) => `${a.modality_name} ${a.name}`.localeCompare(`${b.modality_name} ${b.name}`, "pt-BR"));
  const teamsHtml = sortedTeams.length ? `<div class="table-wrap"><table class="teams-roster-table"><thead><tr><th>Equipe / competidor</th><th>Modalidade</th><th>Classe</th><th>Participantes</th><th>Inscrição</th></tr></thead><tbody>${sortedTeams.map(renderTeamRoster).join("")}</tbody></table></div>` : '<p class="empty-inline">Nenhuma inscrição cadastrada.</p>';
  const crest = crestDataUrl
    ? `<img class="report-crest" src="${crestDataUrl}" alt="Brasão da escola">`
    : '<div class="report-crest report-crest--fallback">GP</div>';
  const completionRate = allMatches.length ? Math.round((completedMatches / allMatches.length) * 100) : 0;

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Relatório oficial · Jogos 2026</title>
<style>
:root{--ink:#211f1a;--ink-soft:#343027;--gold:#e9b93d;--gold-light:#f8e8b7;--paper:#fbfaf7;--muted:#777268;--line:#e8e2d7;--green:#28734f;--red:#b3473e;--blue:#55718a}
*{box-sizing:border-box}html{background:#e9e6df}body{margin:0;padding:28px 18px 54px;color:var(--ink);background:#e9e6df;font:14px/1.55 'DM Sans',Arial,sans-serif;-webkit-font-smoothing:antialiased}.report{width:min(1320px,100%);margin:0 auto;background:#fff;box-shadow:0 22px 70px rgba(35,29,18,.12);overflow:hidden}.report-cover{position:relative;overflow:hidden;min-height:260px;padding:34px 44px 32px;color:#fff;background:radial-gradient(circle at 87% 12%,rgba(233,185,61,.22),transparent 26%),linear-gradient(120deg,#1e1c18 0%,#302b21 67%,#4b3a1f 100%)}.report-cover:before{content:"";position:absolute;width:340px;height:340px;right:3%;top:-175px;border:1px solid rgba(244,207,111,.28);border-radius:50%;box-shadow:0 0 0 26px rgba(244,207,111,.035),0 0 0 58px rgba(244,207,111,.025)}.cover-topline{position:relative;z-index:1;display:flex;align-items:center;gap:15px}.report-crest{width:62px;height:62px;flex:0 0 62px;object-fit:contain;border-radius:50%;padding:5px;background:#fff;border:2px solid rgba(245,205,103,.72)}.report-crest--fallback{display:grid;place-items:center;color:var(--ink);font-weight:900;font-size:22px}.cover-school{display:grid;gap:3px}.cover-school strong{font-size:12px;letter-spacing:.13em}.cover-school small{font-size:9px;letter-spacing:.2em;color:#d3c6a7}.cover-year{margin-left:auto;padding:8px 12px;border:1px solid rgba(239,201,111,.45);border-radius:999px;color:#f7d77f;font-size:10px;font-weight:800;letter-spacing:.15em}.cover-title{position:relative;z-index:1;margin:31px 0 8px;font-size:clamp(34px,4vw,51px);line-height:1.02;letter-spacing:-.055em;font-weight:900}.cover-title span{color:#f1c54e}.cover-subtitle{position:relative;z-index:1;margin:0;color:#d7d0c1;font-size:13px}.cover-bottom{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:27px;padding-top:14px;border-top:1px solid rgba(255,255,255,.15);color:#c5baa3;font-size:10px}.cover-bottom strong{color:#f5d578;letter-spacing:.12em}.report-content{padding:30px 38px 40px}.report-section-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin:0 0 17px}.report-section-heading .section-kicker,.section-kicker{display:block;color:#9a741f;font-size:9px;font-weight:900;letter-spacing:.18em}.report-section-heading h2{margin:4px 0 0;font-size:25px;letter-spacing:-.045em}.generated-at{color:#817b70;font-size:10px;text-align:right}.summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:17px}.summary-stat{position:relative;overflow:hidden;min-height:103px;padding:15px 17px;border:1px solid var(--line);border-radius:13px;background:linear-gradient(145deg,#fff 0%,#faf8f3 100%)}.summary-stat:after{content:"";position:absolute;width:55px;height:55px;right:-13px;bottom:-19px;border:8px solid rgba(231,183,52,.12);border-radius:50%}.summary-stat span,.summary-stat small{display:block;color:#7e786e;font-size:10px}.summary-stat strong{display:block;margin:3px 0;font-size:29px;line-height:1.2;letter-spacing:-.05em}.summary-stat small{font-size:9px}.summary-stat--2 strong{color:#8d6b22}.summary-stat--4 strong{color:var(--green)}.progress-panel{display:flex;align-items:center;gap:14px;padding:13px 16px;border-radius:12px;background:#f5f2eb;margin-bottom:32px}.progress-panel__copy{flex:1;min-width:0}.progress-panel__copy strong{display:block;font-size:11px}.progress-panel__copy small{color:#777268;font-size:9px}.progress-track{height:7px;overflow:hidden;margin-top:8px;border-radius:99px;background:#e3ddd1}.progress-track span{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#d6a62e,#f0ca63)}.progress-value{font-size:20px;font-weight:900;letter-spacing:-.04em;color:#826019}.champions-overview{margin:4px 0 32px}.champions-overview>.section-kicker{margin-bottom:11px}.champions-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.champion-mini{display:flex;align-items:center;gap:12px;padding:13px 15px;border:1px solid #e9d6a4;border-radius:12px;background:linear-gradient(120deg,#fff9e8,#fffdf6)}.champion-mini>span{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:#f5e5b5;font-size:20px}.champion-mini div{display:grid;gap:1px;min-width:0}.champion-mini small{font-size:9px;color:#92732e;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.champion-mini strong{font-size:13px;overflow-wrap:anywhere}.champion-mini em{font-size:9px;color:#777268;font-style:normal}.report-tournament{margin:0 0 30px;border:1px solid #e4ded2;border-radius:17px;overflow:hidden;background:#fff}.report-tournament__header{display:flex;align-items:center;gap:14px;padding:19px 21px;background:linear-gradient(110deg,#f8f5ed,#fff);border-bottom:1px solid var(--line)}.tournament-number{display:grid;place-items:center;width:43px;height:43px;flex:0 0 43px;border-radius:13px;background:#26231d;color:#f4ca54;font-size:14px;font-weight:900}.report-tournament__identity{flex:1;min-width:0}.eyebrow-small{display:block;color:#987322;font-size:8px;font-weight:900;letter-spacing:.15em}.report-tournament__identity h2{margin:3px 0 2px;font-size:22px;letter-spacing:-.045em}.report-tournament__identity p{margin:0;color:#7f796f;font-size:9px}.tournament-state{padding:7px 10px;border:1px solid #e5dfd3;border-radius:99px;background:#fff;color:#756f65;font-size:8px;font-weight:800;white-space:nowrap}.tournament-state.is-complete{border-color:#c9dfd0;background:#eff8f1;color:var(--green)}.champion-panel{display:flex;align-items:center;gap:13px;margin:17px 20px 0;padding:14px 16px;border:1px solid #e2c46f;border-radius:13px;background:linear-gradient(105deg,#f4d36f 0%,#fff0bd 68%,#fff8e4 100%);color:#2d2514}.champion-panel__cup{display:grid;place-items:center;width:47px;height:47px;flex:0 0 47px;border-radius:14px;background:rgba(255,255,255,.55);font-size:25px}.champion-panel>div:nth-child(2){display:grid;gap:1px;min-width:0}.champion-panel span{font-size:8px;font-weight:900;letter-spacing:.14em}.champion-panel strong{font-size:18px;letter-spacing:-.025em;overflow-wrap:anywhere}.champion-panel small{font-size:9px;color:#68572c}.champion-panel__stamp{margin-left:auto;display:grid;place-items:center;width:50px;height:50px;border:1px dashed #a47b20;border-radius:50%;text-align:center;font-size:10px!important;line-height:1.15;color:#765512}.report-phase{padding:23px 20px 26px}.phase-heading{display:flex;align-items:center;gap:12px;margin-bottom:16px}.phase-index{display:grid;place-items:center;width:35px;height:35px;flex:0 0 35px;border-radius:11px;background:#f5e8c4;color:#765916;font-weight:900;font-size:12px}.phase-heading h3{margin:2px 0 2px;font-size:18px;letter-spacing:-.035em}.phase-heading p{margin:0;color:#817b70;font-size:9px}.group-report-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.group-report-card{border:1px solid #e7e1d6;border-radius:13px;overflow:hidden;background:#fcfbf8;break-inside:avoid}.group-report-card__header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;background:#f5f2ea;border-bottom:1px solid #e7e1d6}.group-report-card__header h4{margin:2px 0 0;font-size:14px}.group-progress{font-size:8px;font-weight:800;color:#716a5e}.group-match-list{display:grid;gap:7px;padding:9px}.group-match{padding:8px 9px;border:1px solid #ece7df;border-radius:9px;background:#fff}.group-match>header{display:flex;justify-content:space-between;gap:8px;margin-bottom:5px;color:#827c72;font-size:8px}.group-match>header b{font-size:7px;letter-spacing:.06em;text-transform:uppercase}.group-match.is-done>header b{color:var(--green)}.group-match.is-live>header b{color:#b47c18}.report-team{display:flex;align-items:center;gap:7px;min-height:28px;padding:4px 6px;border-radius:6px}.report-team+.report-team{border-top:1px solid #f0ece5}.report-team.is-winner{background:#eef7ef}.report-team__identity{display:grid;flex:1;min-width:0;gap:0}.report-team__identity strong{font-size:9px;line-height:1.2;overflow-wrap:anywhere}.report-team__identity small{font-size:7px;color:#898276}.report-team__score{min-width:23px;text-align:center;font-size:13px;font-weight:900}.report-team__winner{padding:3px 5px;border-radius:4px;background:#d9eddd;color:#23633e;font-size:6px;font-weight:900;letter-spacing:.06em}.bracket-label{margin:0 20px -4px;padding-top:10px;color:#8c6a1c;font-size:8px;font-weight:900;letter-spacing:.17em}.report-knockout-phase{padding-top:20px}.bracket-legend{display:flex;flex-wrap:wrap;gap:15px;margin:-4px 0 15px;color:#797368;font-size:8px}.bracket-legend span{display:inline-flex;align-items:center;gap:6px}.legend-dot{width:7px;height:7px;border-radius:50%;background:#c5beb1}.legend-dot--done{background:#39835a}.legend-dot--live{background:#e4a82c}.legend-dot--pending{background:#a8a195}.bracket-round-headings{display:flex;align-items:center;margin-bottom:8px}.bracket-round-heading{display:flex;align-items:center;gap:7px;min-width:0;padding:0 2px 7px;border-bottom:2px solid #e5dfd4}.bracket-round-heading>span{display:grid;place-items:center;width:20px;height:20px;border-radius:6px;background:#eee9df;color:#746d60;font-size:8px;font-weight:900}.bracket-round-heading strong{font-size:9px;letter-spacing:.02em}.bracket-round-heading.is-final{border-color:#d8ad39}.bracket-round-heading.is-final>span{background:#eecb68;color:#4d3910}.bracket-viewport{overflow-x:auto;overflow-y:hidden;scrollbar-width:thin;scrollbar-color:#d6c7a4 transparent;padding:2px 1px 8px}.bracket-canvas{position:relative}.bracket-connectors{position:absolute;inset:0;z-index:0;overflow:visible;pointer-events:none}.bracket-connectors path{fill:none;stroke:#c9bea6;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round}.bracket-match{position:absolute;z-index:1;display:flex;flex-direction:column;justify-content:flex-start;padding:7px 8px 5px;border:1px solid #ddd7cb;border-radius:10px;background:#fff;box-shadow:0 5px 13px rgba(31,26,17,.055);overflow:hidden}.bracket-match>header{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px;color:#898174;font-size:6px;letter-spacing:.12em;font-weight:900}.bracket-match>header b{color:#a17a20;font-size:7px}.bracket-match .report-team{min-height:29px;padding:3px 5px}.bracket-match .report-team__identity strong{font-size:8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.bracket-match .report-team__identity small{font-size:6px}.bracket-match .report-team__score{font-size:12px}.bracket-match .report-team__winner{font-size:5px;padding:2px 4px}.bracket-match>footer{display:flex;align-items:center;gap:5px;margin-top:auto;padding-top:3px;color:#888174;font-size:6px}.match-status-dot{width:5px;height:5px;flex:0 0 5px;border-radius:50%;background:#aaa398}.bracket-match.is-done .match-status-dot{background:#39835a}.bracket-match.is-live .match-status-dot{background:#e1a225;box-shadow:0 0 0 3px rgba(225,162,37,.12)}.bracket-match.is-final-match{border:1.5px solid #d7b04d;background:linear-gradient(150deg,#fffdf6,#fff8e4);box-shadow:0 7px 18px rgba(153,113,25,.1)}.bracket-match.is-final-match>header{color:#86651c}.bracket-match.is-final-match>header b{color:#6d4d09}.bracket-match.is-final-match .report-team.is-winner{background:#f6e5ad}.bracket-pending{display:flex;align-items:center;gap:14px;margin:5px 0;padding:20px;border:1px dashed #d9c99e;border-radius:13px;background:#fffbef}.bracket-pending__icon{font-size:25px}.bracket-pending strong{font-size:12px}.bracket-pending p{margin:4px 0 0;color:#7e7668;font-size:9px}.report-tournament__footer{display:flex;justify-content:space-between;gap:12px;padding:11px 20px;background:#faf8f3;border-top:1px solid var(--line);color:#898174;font-size:8px;letter-spacing:.08em}.empty-report{display:grid;justify-items:center;gap:7px;padding:45px 20px;border:1px dashed #d9ceb8;border-radius:14px;text-align:center;background:#fcfaf4}.empty-report>span{font-size:27px}.empty-report strong{font-size:15px}.empty-report p{max-width:410px;margin:0;color:#817b70;font-size:10px}.teams-section{margin-top:36px}.table-wrap{overflow:visible;border:1px solid #e6e0d5;border-radius:13px}.teams-roster-table{width:100%;border-collapse:collapse}.teams-roster-table th{padding:10px 11px;background:#f4f1e9;color:#746d60;text-align:left;font-size:8px;letter-spacing:.09em;text-transform:uppercase}.teams-roster-table td{padding:10px 11px;border-top:1px solid #eee9e0;vertical-align:top;font-size:9px}.teams-roster-table td:first-child strong{display:block;font-size:10px}.roster-list{display:flex;flex-wrap:wrap;gap:4px}.roster-person{padding:3px 6px;border-radius:5px;background:#f2f0eb;font-size:8px}.roster-person.is-banned,.ban-tag{background:#fae8e5;color:#9f332d}.ban-tag{display:inline-block;margin-top:3px;padding:2px 5px;border-radius:4px;font-size:6px;font-weight:900}.teams-roster-table tr.is-banned td{background:#fff9f8}.empty-inline{color:#817b70;font-size:10px}.report-footer{display:flex;justify-content:space-between;gap:16px;margin-top:35px;padding-top:13px;border-top:1px solid #e7e1d6;color:#8b8477;font-size:8px}.report-footer strong{color:#6f5517;letter-spacing:.1em}
@media(max-width:760px){body{padding:0;background:#fff}.report-content{padding:22px 16px}.report-cover{padding:27px 22px}.report-cover:before{right:-35%}.summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.report-tournament__header{flex-wrap:wrap;padding:15px}.tournament-state{margin-left:57px}.report-phase{padding-inline:13px}.bracket-viewport{max-width:calc(100vw - 42px)}.report-section-heading{align-items:flex-start;flex-direction:column}.generated-at{text-align:left}.cover-year{display:none}.teams-roster-table{min-width:760px}.table-wrap{overflow-x:auto}}
@media print{@page{size:A3 landscape;margin:12mm}html,body{background:#fff!important;padding:0!important}.report{width:100%;max-width:none;box-shadow:none}.report-cover{min-height:215px;print-color-adjust:exact;-webkit-print-color-adjust:exact}.report-content{padding:10mm}.report-tournament{break-inside:avoid;page-break-inside:avoid}.bracket-viewport{height:var(--print-height)!important;overflow:visible!important;padding:0!important}.bracket-canvas{transform:scale(var(--print-scale));transform-origin:top left}.bracket-match,.champion-panel,.summary-stat,.group-report-card,.champion-mini{print-color-adjust:exact;-webkit-print-color-adjust:exact}.teams-section{break-before:page}.table-wrap{overflow:visible}.teams-roster-table{min-width:0}.report-footer{margin-top:18px}.no-print{display:none!important}}
</style></head><body>
<div class="report">
  <header class="report-cover">
    <div class="cover-topline">${crest}<div class="cover-school"><strong>ESCOLA ESTADUAL BRIGADEIRO GAVIÃO PEIXOTO</strong><small>ORGANIZAÇÃO · ESPORTE · INTEGRAÇÃO</small></div><span class="cover-year">JOGOS 2026</span></div>
    <h1 class="cover-title">Relatório de <span>resultados.</span></h1>
    <p class="cover-subtitle">Chaves, confrontos, classificação e registro das equipes participantes.</p>
    <div class="cover-bottom"><span>DOCUMENTO OFICIAL DO CAMPEONATO</span><strong>GERADO EM ${safeText(today.toUpperCase())} · ${safeText(time)}</strong></div>
  </header>
  <main class="report-content">
    <div class="report-section-heading"><div><span class="section-kicker">PANORAMA GERAL</span><h2>O campeonato em números</h2></div><span class="generated-at">${safeText(tournaments.length)} modalidade(s) com sorteio · ${liveMatches} jogo(s) ao vivo</span></div>
    <section class="summary-grid">${statCards}</section>
    <section class="progress-panel"><div class="progress-panel__copy"><strong>Andamento dos jogos</strong><small>${completedMatches} de ${allMatches.length} confrontos concluídos</small><div class="progress-track"><span style="width:${completionRate}%"></span></div></div><strong class="progress-value">${completionRate}%</strong></section>
    ${championsHtml}
    <div class="report-section-heading"><div><span class="section-kicker">TRAJETÓRIA ATÉ A DECISÃO</span><h2>Chaves e resultados</h2></div><span class="generated-at">Cada modalidade apresenta seu próprio caminho até a final.</span></div>
    ${tournamentsHtml}
    <section class="teams-section">
      <div class="report-section-heading"><div><span class="section-kicker">REGISTRO DE PARTICIPAÇÃO</span><h2>Equipes e participantes</h2></div><span class="generated-at">${teams.length} inscrição(ões) registradas</span></div>
      ${teamsHtml}
    </section>
    <footer class="report-footer"><span>ESCOLA ESTADUAL BRIGADEIRO GAVIÃO PEIXOTO · JOGOS 2026</span><strong>ORGANIZAR. JOGAR. CELEBRAR.</strong></footer>
  </main>
</div>
</body></html>`;
}

function addPdfPrintControls(reportHtml) {
  const toolbarStyles = `
.pdf-toolbar{width:min(1320px,100%);margin:0 auto 14px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:14px;border:1px solid #e1d7c2;border-radius:12px;background:#fffdf7;color:#51472f;font:12px/1.4 Arial,sans-serif;box-shadow:0 8px 25px rgba(35,29,18,.08)}
.pdf-toolbar strong{display:block;color:#30291b;font-size:13px}.pdf-toolbar small{display:block;margin-top:2px;color:#786f5e}.pdf-toolbar button{flex:0 0 auto;padding:11px 16px;border:0;border-radius:8px;background:#29251d;color:#f5d77d;font-weight:800;cursor:pointer}.pdf-toolbar button:hover{background:#403821}
@media print{.pdf-toolbar{display:none!important}.bracket-viewport{overflow:visible!important}.bracket-canvas{transform:scale(var(--print-scale));transform-origin:top left}}
`;
  const toolbar = `<div class="pdf-toolbar no-print"><div><strong>Relatório pronto para PDF</strong><small>Na janela de impressão, escolha “Salvar como PDF” como destino.</small></div><button id="pdf-export-button" type="button">Salvar em PDF</button></div>`;
  const printScript = `<script>
(function(){
  async function printReport(){
    try {
      if(document.fonts && document.fonts.ready) await document.fonts.ready;
      await Promise.all(Array.from(document.images).map(function(img){
        if(img.complete) return Promise.resolve();
        if(typeof img.decode === 'function') return img.decode().catch(function(){});
        return new Promise(function(resolve){ img.addEventListener('load',resolve,{once:true}); img.addEventListener('error',resolve,{once:true}); });
      }));
    } catch(e) { /* A impressão pode continuar mesmo se uma imagem falhar. */ }
    setTimeout(function(){ window.focus(); window.print(); }, 350);
  }
  document.getElementById('pdf-export-button')?.addEventListener('click', function(){ window.print(); });
  window.addEventListener('load', printReport, {once:true});
})();
</script>`;
  return reportHtml
    .replace("</style>", `${toolbarStyles}</style>`)
    .replace("<body>", `<body>${toolbar}`)
    .replace("</body>", `${printScript}</body>`);
}

exportButton?.addEventListener("click", async () => {
  const originalLabel = exportButton.innerHTML;
  exportButton.disabled = true;
  exportButton.textContent = "Preparando PDF…";
  let reportWindow = null;
  try {
    // Abre a janela diretamente no clique para evitar bloqueio de pop-up pelo navegador.
    reportWindow = window.open("", "_blank");
    if (!reportWindow) throw new Error("O navegador bloqueou a janela do relatório. Permita pop-ups para este site e tente novamente.");
    reportWindow.document.open();
    reportWindow.document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Preparando relatório</title></head><body style="font:16px Arial;padding:32px">Preparando o relatório dos Jogos…</body></html>');
    reportWindow.document.close();

    const snapshot = window.getInterclasseReportSnapshot?.();
    if (!snapshot) throw new Error("Os dados do painel ainda não foram carregados. Atualize a página e tente novamente.");
    const crestDataUrl = await loadCrestDataUrl();
    const report = addPdfPrintControls(buildReport(snapshot, crestDataUrl));
    reportWindow.document.open();
    reportWindow.document.write(report);
    reportWindow.document.close();
    reportWindow.focus();
  } catch (error) {
    if (reportWindow && !reportWindow.closed) reportWindow.close();
    window.alert(error?.message || "Não foi possível gerar o PDF de resultados.");
  } finally {
    exportButton.disabled = false;
    exportButton.innerHTML = originalLabel;
  }
});

function showResetMessage(message, type = "error") {
  if (!resetMessage) return;
  resetMessage.textContent = message;
  resetMessage.className = `form-message form-message--${type}`;
  resetMessage.hidden = false;
}

$("#open-reset-dialog")?.addEventListener("click", () => {
  if (!resetDialog || !resetInput || !resetButton || !resetMessage) return;
  resetInput.value = "";
  resetButton.disabled = true;
  resetMessage.hidden = true;
  resetDialog.showModal();
  resetInput.focus();
});
const closeResetDialog = () => resetDialog?.close();
$("#close-reset-dialog")?.addEventListener("click", closeResetDialog);
$("#cancel-reset-database")?.addEventListener("click", closeResetDialog);
resetInput?.addEventListener("input", () => {
  resetButton.disabled = resetInput.value.trim() !== "APAGAR TUDO";
});

resetButton?.addEventListener("click", async () => {
  if (resetInput?.value.trim() !== "APAGAR TUDO") return;
  const originalLabel = resetButton.textContent;
  resetButton.disabled = true;
  resetButton.textContent = "Apagando dados…";
  try {
    const client = await getSupabase();
    if (!client) throw new Error("Supabase não configurado. Confira js/config.js.");
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    const user = sessionData?.session?.user;
    if (!user) throw new Error("Sua sessão expirou. Entre novamente como administrador.");
    const { data: adminRecord, error: adminError } = await client
      .from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
    if (adminError) throw adminError;
    if (!adminRecord) throw new Error("A conta conectada não possui permissão de administrador.");
    const { error } = await client.rpc("admin_reset_interclasse_data");
    if (error) {
      if (/function .*admin_reset_interclasse_data.* does not exist|could not find the function/i.test(error.message || "")) {
        throw new Error("A função segura admin_reset_interclasse_data ainda não foi criada no Supabase.");
      }
      throw error;
    }
    closeResetDialog();
    window.alert("Dados do campeonato apagados. A conta de administrador foi preservada.");
    window.location.reload();
  } catch (error) {
    showResetMessage(error?.message || "Não foi possível resetar os dados.", "error");
    resetButton.disabled = false;
    resetButton.textContent = originalLabel;
  }
});
