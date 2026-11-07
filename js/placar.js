import { getSupabase, isSupabaseConfigured } from "./supabase.js";

const $ = (selector) => document.querySelector(selector);
const tabsHost = $("#bracket-tabs");
const bracketHost = $("#bracket-host");
const statusEl = $("#scoreboard-status");
const updatedEl = $("#scoreboard-updated");
const messageEl = $("#scoreboard-message");
const shell = $(".scoreboard-main");
let refreshing = false;
let supabase = null;
let tournaments = [];
let activeTournamentId = null;
let selectedMatchId = null;
let bracketZoom = 1;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function parsePayload(value) {
  if (typeof value === "string") { try { return JSON.parse(value); } catch (_) { return {}; } }
  return value && typeof value === "object" ? value : {};
}
function roundLabel(round, maxRound) {
  if (round === maxRound) return "Final";
  if (round === maxRound - 1) return "Semifinal";
  if (round === maxRound - 2 && maxRound >= 3) return "Quartas de final";
  if (round === maxRound - 3 && maxRound >= 4) return "Oitavas de final";
  return round === 1 ? "Primeira rodada" : `Rodada ${round}`;
}
function phaseLabel(tournament, match) {
  if (match.phase === "groups") return `${match.group_name || "Fase de grupos"} · Jogo ${match.match_number}`;
  const knockouts = (tournament.matches || []).filter((item) => item.phase === "knockout");
  const maxRound = Math.max(1, ...knockouts.map((item) => Number(item.round_number) || 1));
  return `${roundLabel(Number(match.round_number) || 1, maxRound)} · Jogo ${match.match_number}`;
}
function teamName(match, side) {
  return match[`${side}_team_name`] || (side === "home" ? "A definir" : "A definir");
}
function teamClass(match, side) {
  return match[`${side}_classroom`] || "";
}
function statusLabel(match) {
  if (match.status === "in_progress") return "Ao vivo";
  if (match.status === "completed") return "Finalizado";
  if (match.status === "bye") return "Avanço automático";
  return match.home_team_id && match.away_team_id ? "Aguardando início" : "Aguardando equipes";
}
function matchCard(tournament, match, position = null) {
  const hasScore = match.home_score !== null && match.home_score !== undefined && match.away_score !== null && match.away_score !== undefined;
  const state = match.status === "in_progress" ? "is-live" : match.status === "completed" ? "is-completed" : match.status === "bye" ? "is-bye" : "is-pending";
  const homeWinner = match.winner_team_id && String(match.winner_team_id) === String(match.home_team_id);
  const awayWinner = match.winner_team_id && String(match.winner_team_id) === String(match.away_team_id);
  const style = position ? ` style="left:${position.left}px;top:${position.top}px;width:${position.width}px"` : "";
  return `<button type="button" class="bracket-match ${state} ${position ? "is-positioned" : ""}" data-match-id="${esc(match.id)}"${style} aria-label="Abrir ${esc(phaseLabel(tournament, match))}: ${esc(teamName(match, "home"))} contra ${esc(teamName(match, "away"))}">
    <span class="bracket-match__meta"><span>${esc(phaseLabel(tournament, match))}</span><b>${esc(statusLabel(match))}</b></span>
    <span class="bracket-match__team ${homeWinner ? "is-winner" : ""}"><span><strong>${esc(teamName(match, "home"))}</strong><small>${esc(teamClass(match, "home"))}</small></span><b>${hasScore ? esc(match.home_score) : "–"}</b></span>
    <span class="bracket-match__team ${awayWinner ? "is-winner" : ""}"><span><strong>${esc(teamName(match, "away"))}</strong><small>${esc(teamClass(match, "away"))}</small></span><b>${hasScore ? esc(match.away_score) : "–"}</b></span>
    <span class="bracket-match__open">Ver partida <i aria-hidden="true">↗</i></span>
  </button>`;
}
function renderBracketTree(tournament, knockout, rounds, maxRound) {
  const isNarrowScreen = window.matchMedia("(max-width: 720px)").matches;
  const CARD_WIDTH = isNarrowScreen ? Math.max(210, Math.min(232, Math.round(window.innerWidth * 0.59))) : 264;
  const CARD_HEIGHT = 136;
  const COLUMN_GAP = isNarrowScreen ? Math.max(52, Math.round(CARD_WIDTH * 0.25)) : 82;
  const ROW_HEIGHT = 160;
  const HEADING_HEIGHT = 58;
  const columnStep = CARD_WIDTH + COLUMN_GAP;
  const firstRoundCount = Math.max(1, rounds[0]?.matches.length || 1);
  const totalWidth = rounds.length * CARD_WIDTH + Math.max(0, rounds.length - 1) * COLUMN_GAP;
  const totalHeight = HEADING_HEIGHT + firstRoundCount * ROW_HEIGHT + 18;
  const centerY = (roundIndex, matchIndex) =>
    (matchIndex * (2 ** roundIndex) + (2 ** (roundIndex - 1))) * ROW_HEIGHT;

  let connectors = "";
  rounds.slice(0, -1).forEach((round, roundIndex) => {
    const nextRound = rounds[roundIndex + 1];
    nextRound.matches.forEach((_, targetIndex) => {
      const targetY = HEADING_HEIGHT + centerY(roundIndex + 1, targetIndex);
      [targetIndex * 2, targetIndex * 2 + 1].forEach((sourceIndex) => {
        if (!round.matches[sourceIndex]) return;
        const sourceY = HEADING_HEIGHT + centerY(roundIndex, sourceIndex);
        const startX = roundIndex * columnStep + CARD_WIDTH;
        const endX = (roundIndex + 1) * columnStep;
        const middleX = startX + (endX - startX) / 2;
        connectors += `<path d="M ${startX} ${sourceY} H ${middleX} V ${targetY} H ${endX}"/>`;
      });
    });
  });

  const headings = rounds.map((round, index) => {
    const label = roundLabel(round.number, maxRound);
    const left = index * columnStep;
    const count = round.matches.length;
    return `<div class="bracket-round-heading ${index === rounds.length - 1 ? "is-final" : ""}" style="left:${left}px;width:${CARD_WIDTH}px">
      <span class="bracket-round-heading__index">${String(index + 1).padStart(2, "0")}</span>
      <span class="bracket-round-heading__copy"><strong>${esc(label)}</strong><small>${count} ${count === 1 ? "partida" : "partidas"}</small></span>
      ${index === rounds.length - 1 ? '<span class="bracket-round-heading__crown" aria-hidden="true">♛</span>' : ""}
    </div>`;
  }).join("");

  const cards = rounds.map((round, roundIndex) => round.matches.map((match, matchIndex) => {
    const left = roundIndex * columnStep;
    const top = HEADING_HEIGHT + centerY(roundIndex, matchIndex) - CARD_HEIGHT / 2;
    return matchCard(tournament, match, { left, top, width: CARD_WIDTH });
  }).join("")).join("");

  const decided = knockout.filter((match) => ["completed", "bye"].includes(match.status)).length;
  const treeStyle = `width:${totalWidth}px;height:${totalHeight}px`;
  return `<div class="bracket-zoom-controls" aria-label="Controles de zoom"><button type="button" data-bracket-zoom="out" aria-label="Diminuir zoom">−</button><output>${Math.round(bracketZoom*100)}%</output><button type="button" data-bracket-zoom="in" aria-label="Aumentar zoom">+</button><button type="button" data-bracket-zoom="reset">Ajustar</button></div><div class="bracket-knockout__progress"><span><i class="bracket-legend-dot is-completed"></i> Finalizado</span><span><i class="bracket-legend-dot is-live"></i> Ao vivo</span><span><i class="bracket-legend-dot is-pending"></i> Aguardando</span><strong>${decided} de ${knockout.length} decididos</strong></div>
    <div class="bracket-tree-scroll" tabindex="0" role="region" aria-label="Árvore de jogos. Use a rolagem horizontal e vertical para acompanhar todas as rodadas.">
      <div class="bracket-tree" style="${treeStyle};zoom:${bracketZoom}">
        <svg class="bracket-tree__connectors" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}" aria-hidden="true">${connectors}</svg>
        ${headings}${cards}
      </div>
    </div>
    <p class="bracket-tree__hint"><span aria-hidden="true">↔</span> Arraste para os lados e role a página para acompanhar toda a árvore até a final</p>`;
}
function renderTournamentTree(tournament) {
  if (!tournament) return emptyMarkup("◷", "Nenhum chaveamento disponível", "Quando a organização gerar os confrontos, eles aparecerão aqui.");
  const matches = Array.isArray(tournament.matches) ? tournament.matches : [];
  if (!matches.length) return emptyMarkup("⚑", "Chaveamento ainda não gerado", "A organização ainda não sorteou os confrontos desta modalidade.");

  const groups = [...new Set(matches.filter((match) => match.phase === "groups").map((match) => match.group_name || "Fase de grupos"))];
  const isGroupStage = tournament.status === "groups";
  const groupsMarkup = isGroupStage && groups.length ? `<div class="bracket-groups">${groups.map((groupName) => {
    const groupMatches = matches.filter((match) => match.phase === "groups" && (match.group_name || "Fase de grupos") === groupName)
      .sort((a, b) => Number(a.match_number) - Number(b.match_number));
    return `<section class="bracket-group"><header><h3>${esc(groupName)}</h3><span>${groupMatches.filter((match) => match.status === "completed").length}/${groupMatches.length} jogos finalizados</span></header><div class="bracket-group__matches ${groupMatches.length > 4 ? "is-dense" : ""}">${groupMatches.map((match) => matchCard(tournament, match)).join("")}</div></section>`;
  }).join("")}</div>` : "";

  const knockout = tournament.status === "groups" ? [] : matches.filter((match) => match.phase === "knockout");
  const maxRound = Math.max(0, ...knockout.map((match) => Number(match.round_number) || 0));
  const rounds = [...new Set(knockout.map((match) => Number(match.round_number) || 1))]
    .sort((a, b) => a - b)
    .map((number) => ({
      number,
      matches: knockout.filter((match) => (Number(match.round_number) || 1) === number)
        .sort((a, b) => Number(a.match_number) - Number(b.match_number))
    }));
  const knockoutMarkup = knockout.length ? `<section class="bracket-knockout"><div class="bracket-knockout__heading"><div><span class="section-kicker">CAMINHO ATÉ O TÍTULO</span><h3>${tournament.format === "groups" ? "Mata-mata final" : "Chave eliminatória"}</h3></div><span class="bracket-knockout__subtitle">Os vencedores avançam para a próxima rodada</span></div>${renderBracketTree(tournament, knockout, rounds, maxRound)}</section>` : "";

  const champion = tournament.status === "completed" && tournament.winner_team_name
    ? `<div class="bracket-champion"><span>🏆</span><div><small>CAMPEÃO DA MODALIDADE</small><strong>${esc(tournament.winner_team_name)}</strong></div></div>` : "";
  return `<div class="bracket-tournament-heading"><div><span class="section-kicker">${tournament.format === "groups" ? "FASE DE GRUPOS + MATA-MATA" : "MATA-MATA"}</span><h2>${esc(tournament.modality_name || "Modalidade")}</h2></div><span class="bracket-match-count">${matches.length} ${matches.length === 1 ? "jogo" : "jogos"}</span></div>${champion}${groupsMarkup}${knockoutMarkup}`;
}
function emptyMarkup(icon, title, description) {
  return `<article class="scoreboard-empty"><span class="scoreboard-empty__icon">${icon}</span><h3>${title}</h3><p>${description}</p></article>`;
}
function renderTabs() {
  if (!tournaments.length) {
    tabsHost.innerHTML = "";
    return;
  }
  if (!tournaments.some((tournament) => String(tournament.id) === String(activeTournamentId))) {
    activeTournamentId = tournaments[0].id;
  }
  tabsHost.innerHTML = tournaments.map((tournament) => {
    const active = String(tournament.id) === String(activeTournamentId);
    const liveCount = (tournament.matches || []).filter((match) => match.status === "in_progress").length;
    return `<button type="button" role="tab" class="bracket-tab ${active ? "is-active" : ""}" data-tournament-id="${esc(tournament.id)}" aria-selected="${active}"><span>${esc(tournament.modality_name || "Modalidade")}</span>${liveCount ? `<b>${liveCount} ao vivo</b>` : ""}</button>`;
  }).join("");
}
function refreshSelectedMatch() {
  if (!selectedMatchId || singleMatchScreen.hidden) return;
  const tournament = tournaments.find((item) => (item.matches || []).some((match) => String(match.id) === String(selectedMatchId)));
  const match = tournament?.matches?.find((item) => String(item.id) === String(selectedMatchId));
  if (!match || !tournament) { closeSingleMatch(false); return; }
  singleMatchScreen.innerHTML = singleMatchMarkup(tournament, match);
}
function render() {
  const currentTree = bracketHost.querySelector(".bracket-tree-scroll");
  const scrollSnapshot = {
    pageY: window.scrollY,
    treeLeft: currentTree?.scrollLeft || 0,
    treeTop: currentTree?.scrollTop || 0
  };
  const liveCount = tournaments.reduce((total, tournament) => total + (tournament.matches || []).filter((match) => match.status === "in_progress").length, 0);
  const matchCount = tournaments.reduce((total, tournament) => total + (tournament.matches || []).length, 0);
  statusEl.textContent = liveCount ? `${liveCount} ${liveCount === 1 ? "partida em andamento" : "partidas em andamento"}` : matchCount ? "Nenhuma partida em andamento" : "Nenhum jogo publicado ainda";
  statusEl.classList.toggle("has-live", liveCount > 0);
  renderTabs();
  const activeTournament = tournaments.find((item) => String(item.id) === String(activeTournamentId));
  bracketHost.innerHTML = activeTournament ? renderTournamentTree(activeTournament) : emptyMarkup("◷", "Nenhum chaveamento disponível", "Os jogos serão exibidos aqui quando forem sorteados.");
  const updatedTree = bracketHost.querySelector(".bracket-tree-scroll");
  if (updatedTree && currentTree) {
    updatedTree.scrollLeft = scrollSnapshot.treeLeft;
    updatedTree.scrollTop = scrollSnapshot.treeTop;
  }
  if (window.scrollY !== scrollSnapshot.pageY) window.scrollTo(0, scrollSnapshot.pageY);
  updatedEl.textContent = `Atualizado às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  refreshSelectedMatch();
}

const singleMatchScreen = document.createElement("section");
singleMatchScreen.id = "single-match-screen";
singleMatchScreen.className = "single-match-screen";
singleMatchScreen.hidden = true;
singleMatchScreen.setAttribute("role", "dialog");
singleMatchScreen.setAttribute("aria-modal", "true");
singleMatchScreen.setAttribute("aria-label", "Placar individual em tela cheia");
document.body.append(singleMatchScreen);
function singleMatchMarkup(tournament, match) {
  const finished = match.status === "completed";
  const live = match.status === "in_progress";
  const hasScore = match.home_score !== null && match.home_score !== undefined && match.away_score !== null && match.away_score !== undefined;
  return `<div class="single-match-screen__inner">
    <header class="single-match-screen__header"><div class="single-match-brand"><img src="assets/brasao-escola.png" alt=""><span><strong>JOGOS</strong><small>${esc(tournament.modality_name || "Modalidade")}</small></span></div><button type="button" class="single-match-screen__close" data-close-single-match>✕ Voltar ao chaveamento</button></header>
    <div class="single-match-screen__content"><span class="single-match-screen__eyebrow">${finished ? "RESULTADO FINAL" : live ? "ACOMPANHAMENTO AO VIVO" : "PRÓXIMO CONFRONTO"}</span><h1>${esc(phaseLabel(tournament, match))}</h1>
      <div class="single-match-screen__scoreboard"><section class="single-match-team"><span class="single-match-team__label">EQUIPE A</span><h2>${esc(teamName(match, "home"))}</h2><p>${esc(teamClass(match, "home"))}</p><strong class="single-match-score">${hasScore ? esc(match.home_score) : "–"}</strong></section><div class="single-match-versus">×</div><section class="single-match-team single-match-team--away"><span class="single-match-team__label">EQUIPE B</span><h2>${esc(teamName(match, "away"))}</h2><p>${esc(teamClass(match, "away"))}</p><strong class="single-match-score">${hasScore ? esc(match.away_score) : "–"}</strong></section></div>
      <div class="single-match-screen__status ${finished ? "is-finished" : ""}"><i></i>${esc(statusLabel(match))} · placar sincronizado automaticamente</div><p class="single-match-screen__footer">ESCOLA ESTADUAL BRIGADEIRO GAVIÃO PEIXOTO </p></div></div>`;
}
function openSingleMatch(matchId) {
  const tournament = tournaments.find((item) => (item.matches || []).some((match) => String(match.id) === String(matchId)));
  const match = tournament?.matches?.find((item) => String(item.id) === String(matchId));
  if (!match || !tournament) return;
  selectedMatchId = String(matchId);
  singleMatchScreen.innerHTML = singleMatchMarkup(tournament, match);
  singleMatchScreen.hidden = false;
  document.body.classList.add("single-match-open");
  try { const request = singleMatchScreen.requestFullscreen?.(); if (request?.catch) request.catch(() => {}); } catch (_) { /* A camada fixa permanece disponível. */ }
}
function closeSingleMatch(exitFullscreen = true) {
  selectedMatchId = null;
  singleMatchScreen.hidden = true;
  document.body.classList.remove("single-match-open");
  if (exitFullscreen && document.fullscreenElement === singleMatchScreen) {
    const request = document.exitFullscreen?.();
    if (request?.catch) request.catch(() => {});
  }
}
singleMatchScreen.addEventListener("click", (event) => { if (event.target.closest("[data-close-single-match]")) closeSingleMatch(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !singleMatchScreen.hidden) closeSingleMatch(); });
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && !singleMatchScreen.hidden) closeSingleMatch(false); });
tabsHost.addEventListener("click", (event) => {
  const tab = event.target.closest("button[data-tournament-id]");
  if (!tab) return;
  activeTournamentId = tab.dataset.tournamentId;
  renderTabs();
  const tournament = tournaments.find((item) => String(item.id) === String(activeTournamentId));
  bracketHost.innerHTML = renderTournamentTree(tournament);
});
bracketHost.addEventListener("click", (event) => {
  const zoomButton = event.target.closest("[data-bracket-zoom]");
  if (zoomButton) {
    const action = zoomButton.dataset.bracketZoom;
    bracketZoom = action === "reset" ? 1 : Math.max(.55, Math.min(1.5, bracketZoom + (action === "in" ? .1 : -.1)));
    const tree = bracketHost.querySelector(".bracket-tree");
    if (tree) tree.style.zoom = String(bracketZoom);
    const output = bracketHost.querySelector(".bracket-zoom-controls output");
    if (output) output.textContent = `${Math.round(bracketZoom*100)}%`;
    return;
  }
  const card = event.target.closest("button[data-match-id]");
  if (card) openSingleMatch(card.dataset.matchId);
});
$("#scoreboard-fullscreen")?.addEventListener("click", async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await shell.requestFullscreen(); }
  catch (error) { console.warn("Tela cheia indisponível:", error); }
});

async function refresh() {
  if (refreshing || document.visibilityState === "hidden") return;
  refreshing = true;
  try {
    if (!isSupabaseConfigured()) {
      statusEl.textContent = "Placar ainda não conectado";
      bracketHost.innerHTML = emptyMarkup("⚙", "Configuração pendente", "Conecte o Supabase para publicar inscrições, chaveamentos e placares reais.");
      tabsHost.innerHTML = "";
      return;
    }
    if (!supabase) supabase = await getSupabase();
    const { data, error } = await supabase.rpc("get_public_tournaments");
    if (error) throw error;
    const payload = parsePayload(data);
    tournaments = Array.isArray(payload.tournaments) ? payload.tournaments : [];
    messageEl.hidden = true;
    render();
  } catch (error) {
    console.error("Erro ao buscar os placares:", error);
    messageEl.textContent = "Não foi possível atualizar o chaveamento. Verifique a conexão com o Supabase.";
    messageEl.className = "form-message form-message--error";
    messageEl.hidden = false;
    statusEl.textContent = "Reconectando ao placar…";
  } finally { refreshing = false; }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
refresh();
window.setInterval(refresh, 2500);
