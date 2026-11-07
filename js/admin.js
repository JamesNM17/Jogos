import { getSupabase, isSupabaseConfigured } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const config = window.APP_CONFIG || {};
const loginPanel = $("#login-panel");
const dashboard = $("#dashboard");
const loginForm = $("#login-form");
const loginMessage = $("#login-message");
const loginButton = $("#login-button");
const loginButtonLabel = $(".login-button__label", loginButton);
const passwordInput = $("#admin-password");
const passwordToggle = $("#toggle-admin-password");
const modalityForm = $("#modality-form");
const modalityMessage = $("#modality-form-message");
const modalityList = $("#admin-modalities-list");
const teamTableWrap = $("#teams-table-wrap");
const teamEditorDialog = $("#team-editor-dialog");
const teamEditorForm = $("#team-editor-form");
const matchControllerScreen = $("#match-controller-screen");
const toast = $("#admin-toast");
let supabase = null;
let modalities = [];
let teams = [];
let registrationOpen = true;
let tournaments = [];
let tournamentFeaturesReady = false;
let activeTournamentModalityId = "";
let activeTeamModalityId = "";
let adminBracketZoom = 1;
let controlledMatchId = null;
let matchStartFeedback = null;
let toastTimer;

const adminViewLabels = {
  "visao-geral": "Visão geral",
  modalidades: "Modalidades",
  inscricoes: "Inscrições",
  chaveamento: "Chaveamento e placares"
};
function activateAdminPanel(panelName) {
  if (!adminViewLabels[panelName]) return;
  $$(`[data-admin-panel]`).forEach((panel) => {
    const active = panel.dataset.adminPanel === panelName;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
  $$(`[data-admin-nav]`).forEach((button) => {
    const active = button.dataset.adminNav === panelName;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  const title = $("#admin-view-title");
  if (title) title.textContent = adminViewLabels[panelName];
  if (panelName === "chaveamento") renderMatchController();
}

function setMessage(element, text, type = "info") {
  element.textContent = text;
  element.className = `form-message form-message--${type}`;
  element.hidden = false;
}
function clearMessage(element) { element.hidden = true; element.textContent = ""; }
function notify(text) {
  toast.textContent = text;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3400);
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function modalitySymbol(modality) {
  const name = `${modality?.name || ""} ${modality?.description || ""}`.toLowerCase();
  if (name.includes("fut") || name.includes("futebol")) return "⚽";
  if (name.includes("vôlei") || name.includes("volei")) return "🏐";
  if (name.includes("basquete")) return "🏀";
  if (name.includes("xadrez")) return "♟";
  if (name.includes("queimada")) return "🔥";
  return Number(modality?.participants_per_team) === 1 ? "⚡" : Number(modality?.participants_per_team) === 2 ? "👟" : "🏆";
}
function isTeamEligible(team) {
  if (!team || team.is_banned || (team.team_members || []).some((member) => member.is_banned)) return false;
  const expected = Number(team.modalities?.participants_per_team || 0);
  return !expected || (team.team_members || []).length === expected;
}
function teamEligibilityLabel(team) {
  if (team.is_banned) return String(team.ban_reason || "").startsWith("Desclassificação por W.O.") ? "Equipe desclassificada" : "Equipe banida";
  if ((team.team_members || []).some((member) => member.is_banned)) return "Tem participante banido";
  const expected = Number(team.modalities?.participants_per_team || 0);
  if (expected && (team.team_members || []).length !== expected) return `Elenco incompleto (${(team.team_members || []).length}/${expected})`;
  return "Apta para sorteio";
}
function niceDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(date).replace(" de ", " ");
}
function showLogin() {
  loginPanel.hidden = false;
  dashboard.hidden = true;
}
function showDashboard() {
  loginPanel.hidden = true;
  dashboard.hidden = false;
  activateAdminPanel("visao-geral");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

dashboard.addEventListener("click", (event) => {
  const navigationButton = event.target.closest("[data-admin-nav]");
  if (navigationButton) activateAdminPanel(navigationButton.dataset.adminNav);
});
function setLoginLoading(isLoading) {
  loginButton.disabled = isLoading;
  loginButton.classList.toggle("is-loading", isLoading);
  if (loginButtonLabel) loginButtonLabel.textContent = isLoading ? "Verificando acesso…" : "Entrar no painel";
  loginButton.setAttribute("aria-busy", String(isLoading));
}
function friendlyAuthError(error) {
  const message = String(error?.message || "");
  const code = String(error?.code || "");
  if (/invalid login credentials|invalid_credentials/i.test(`${message} ${code}`)) return "E-mail ou senha incorretos. Confira os dados e tente novamente.";
  if (/email not confirmed|email_not_confirmed/i.test(`${message} ${code}`)) return "Este e-mail ainda não foi confirmado. Verifique sua caixa de entrada ou confirme o usuário no Supabase.";
  if (/too many requests|rate limit|over_request_rate_limit/i.test(`${message} ${code}`)) return "Muitas tentativas em sequência. Aguarde um pouco e tente novamente.";
  if (/invalid api key|api key/i.test(message)) return "A chave pública do Supabase parece incorreta. Confira js/config.js.";
  if (/failed to fetch|networkerror|load failed|fetch failed/i.test(message)) return "Não foi possível conectar ao Supabase. Verifique sua internet e a URL do projeto.";
  if (/admin_users|schema cache|relation .* does not exist|permission denied/i.test(message)) return "Não foi possível validar a permissão de administrador. Execute supabase/schema.sql e confira se o UUID da conta está em admin_users.";
  return message || "Não foi possível entrar. Confira seu e-mail e senha e tente novamente.";
}
passwordToggle?.addEventListener("click", () => {
  const willShow = passwordInput.type === "password";
  passwordInput.type = willShow ? "text" : "password";
  passwordToggle.setAttribute("aria-pressed", String(willShow));
  passwordToggle.setAttribute("aria-label", willShow ? "Ocultar senha" : "Mostrar senha");
  passwordToggle.title = willShow ? "Ocultar senha" : "Mostrar senha";
});
async function isAdminUser(user) {
  if (!user || !supabase) return false;
  const { data, error } = await supabase.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
async function enterDashboard(user) {
  try {
    if (!(await isAdminUser(user))) {
      await supabase.auth.signOut();
      showLogin();
      setMessage(loginMessage, "Esta conta ainda não tem permissão de administrador. Peça à pessoa responsável para cadastrá-la no Supabase.", "error");
      return;
    }
    clearMessage(loginMessage);
    showDashboard();
    await loadEverything();
  } catch (error) {
    console.error("Falha ao verificar administrador:", error);
    showLogin();
    setMessage(loginMessage, friendlyAuthError(error), "error");
  }
}
function resetModalityForm() {
  modalityForm.reset();
  $("#modality-edit-id").value = "";
  $("#modality-size").value = "5";
  $("#modality-active").checked = true;
  $("#modality-form-title").textContent = "Nova modalidade";
  $("#save-modality").innerHTML = "Salvar modalidade <span>↗</span>";
  $("#cancel-modality-edit").hidden = true;
  clearMessage(modalityMessage);
}
function setStats() {
  const allMatches = tournaments.flatMap((tournament) => tournament.matches || []);
  const liveMatches = allMatches.filter((match) => match.status === "in_progress").length;
  const finishedMatches = allMatches.filter((match) => ["completed", "bye"].includes(match.status)).length;
  const activeTournaments = tournaments.filter((tournament) => tournament.status !== "completed").length;

  $("#stat-teams").textContent = String(teams.length);
  $("#stat-modalities").textContent = String(modalities.filter((modality) => modality.is_active).length);
  $("#stat-participants").textContent = String(teams.reduce((sum, team) => sum + (team.team_members || []).length, 0));
  $("#stat-matches").textContent = String(allMatches.length);
  $("#stat-matches-meta").textContent = `${liveMatches} ao vivo · ${finishedMatches} finalizadas`;
  $("#overview-registration-label").textContent = registrationOpen ? "Inscrições abertas" : "Inscrições encerradas";
  $("#overview-registration-meta").textContent = registrationOpen
    ? "O formulário público está recebendo novas equipes."
    : "Novas inscrições estão bloqueadas até a organização reabrir.";
  $("#overview-registration-label").classList.toggle("is-open", registrationOpen);
  $("#overview-registration-label").classList.toggle("is-closed", !registrationOpen);
  $("#overview-tournaments-label").textContent = `${tournaments.length} ${tournaments.length === 1 ? "torneio" : "torneios"}`;
  $("#overview-tournaments-meta").textContent = activeTournaments
    ? `${activeTournaments} em andamento · ${tournaments.length - activeTournaments} concluídos`
    : tournaments.length ? "Todos os campeonatos foram concluídos." : "Os chaveamentos aparecerão aqui após o sorteio.";
  $("#modality-list-count").textContent = `${modalities.length} ${modalities.length === 1 ? "modalidade" : "modalidades"}`;
}
function renderModalities() {
  modalityList.replaceChildren();
  if (!modalities.length) {
    modalityList.innerHTML = '<div class="list-empty"><span>✳</span><strong>Nenhuma modalidade cadastrada</strong><p>Comece adicionando uma modalidade no formulário ao lado.</p></div>';
    return;
  }
  modalities.forEach((modality) => {
    const row = document.createElement("div");
    row.className = "admin-modality-row";
    row.innerHTML = `
      <div class="admin-modality-symbol">${modalitySymbol(modality)}</div>
      <div class="admin-modality-copy"><strong>${esc(modality.name)}</strong><small>${Number(modality.participants_per_team)} ${Number(modality.participants_per_team) === 1 ? "participante" : "participantes"} por equipe</small></div>
      <span class="status-chip ${modality.is_active ? "" : "status-chip--paused"}">${modality.is_active ? "Ativa" : "Pausada"}</span>
      <div class="row-actions"><button class="icon-button" type="button" data-action="edit-modality" data-id="${esc(modality.id)}" aria-label="Editar ${esc(modality.name)}" title="Editar">✎</button><button class="icon-button" type="button" data-action="toggle-modality" data-id="${esc(modality.id)}" aria-label="${modality.is_active ? "Pausar" : "Reabrir"} ${esc(modality.name)}" title="${modality.is_active ? "Pausar inscrições" : "Reabrir inscrições"}">${modality.is_active ? "Ⅱ" : "▶"}</button><button class="icon-button icon-button--danger" type="button" data-action="delete-modality" data-id="${esc(modality.id)}" aria-label="Excluir ${esc(modality.name)}" title="Excluir">×</button></div>`;
    modalityList.append(row);
  });
}
function renderModalityFilter() {
  const host = $("#admin-team-modality-tabs");
  if (!host) return;
  const validIds = new Set(modalities.map((modality) => modality.id));
  if (activeTeamModalityId && !validIds.has(activeTeamModalityId)) activeTeamModalityId = "";
  const tabData = [{ id: "", name: "Todas", count: teams.length, icon: "✦" }, ...modalities.map((modality) => ({
    id: modality.id,
    name: modality.name,
    count: teams.filter((team) => team.modality_id === modality.id).length,
    icon: modalitySymbol(modality)
  }))];
  host.innerHTML = tabData.map((item) => {
    const active = activeTeamModalityId === item.id;
    return `<button type="button" role="tab" class="modality-tab ${active ? "is-active" : ""}" data-admin-team-tab="${esc(item.id)}" aria-selected="${active}" tabindex="${active ? "0" : "-1"}"><span class="modality-tab__icon" aria-hidden="true">${item.icon}</span><span class="modality-tab__copy"><strong>${esc(item.name)}</strong><small>${item.count} ${item.count === 1 ? "inscrição" : "inscrições"}</small></span></button>`;
  }).join("");
  const buttons = [...host.querySelectorAll("[data-admin-team-tab]")];
  buttons.forEach((button, index) => {
    button.addEventListener("click", () => {
      activeTeamModalityId = button.dataset.adminTeamTab;
      renderModalityFilter();
      renderTeams();
    });
    button.addEventListener("keydown", (event) => {
      if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
      buttons[next]?.click();
    });
  });
}
function renderTeams() {
  const query = $("#team-search").value.trim().toLocaleLowerCase("pt-BR");
  const modalityId = activeTeamModalityId;
  const visibleTeams = teams.filter((team) => {
    const people = (team.team_members || []).map((member) => member.name).join(" ");
    const searchable = `${team.name} ${team.classroom} ${team.modalities?.name || ""} ${people}`.toLocaleLowerCase("pt-BR");
    return (!query || searchable.includes(query)) && (!modalityId || team.modality_id === modalityId);
  });
  $("#team-results-count").textContent = `${visibleTeams.length} ${visibleTeams.length === 1 ? "inscrição" : "inscrições"}`;
  teamTableWrap.replaceChildren();
  if (!visibleTeams.length) {
    const empty = document.createElement("div"); empty.className = "table-empty";
    empty.innerHTML = teams.length ? '<span>⌕</span><h3>Nenhuma inscrição encontrada</h3><p>Tente mudar a busca ou o filtro de modalidade.</p>' : '<span>👥</span><h3>As inscrições vão aparecer aqui</h3><p>As equipes cadastradas aparecerão nesta área.</p>';
    teamTableWrap.append(empty); return;
  }
  const grid = document.createElement("div"); grid.className = "teams-card-grid";
  visibleTeams.forEach((team) => {
    const members = [...(team.team_members || [])].sort((a,b)=>(a.member_order||0)-(b.member_order||0));
    const isDisqualified = String(team.ban_reason || "").startsWith("Desclassificação por W.O.");
    const card = document.createElement("button"); card.type="button"; card.className="team-summary-card"; card.dataset.openTeam=team.id;
    card.innerHTML = `<span class="team-summary-card__top"><span class="team-summary-card__category">INSCRIÇÃO · ${esc(team.modalities?.name || "MODALIDADE")}</span>${team.is_banned ? `<span class="team-summary-card__state is-banned">${isDisqualified?"DESCLASSIFICADA":"BANIDA"}</span>` : '<span class="team-summary-card__state is-active">INSCRITA</span>'}</span><span class="team-summary-card__identity"><span class="team-summary-card__symbol">${modalitySymbol(team.modalities)}</span><span class="team-summary-card__name"><strong>${esc(team.name)}</strong><small>${esc(team.classroom || "Turma não informada")}</small></span></span><span class="team-summary-card__details"><span><small>PARTICIPANTES</small><strong>${members.length.toString().padStart(2,"0")}</strong></span><span><small>SITUAÇÃO</small><strong>${team.is_banned ? (isDisqualified?"Desclassificada":"Banida") : (isTeamEligible(team)?"Apta":"Verificar elenco")}</strong></span></span><span class="team-summary-card__bottom"><span>Visualizar cadastro e ações</span><strong>Ver equipe <i aria-hidden="true">↗</i></strong></span>`;
    grid.append(card);
  });
  const dialog = document.createElement("dialog"); dialog.className="team-detail-dialog"; dialog.id="team-detail-dialog"; dialog.setAttribute("aria-label","Detalhes da equipe");
  dialog.innerHTML='<div class="team-detail-dialog__inner" id="team-detail-dialog-content"></div>';
  teamTableWrap.append(grid,dialog);
}
function openTeamDetails(teamId) {
  const team=teams.find(item=>String(item.id)===String(teamId)); if(!team) return;
  const dialog=$("#team-detail-dialog",teamTableWrap); const content=$("#team-detail-dialog-content",dialog); if(!dialog||!content) return;
  const members=[...(team.team_members||[])].sort((a,b)=>(a.member_order||0)-(b.member_order||0));
  const drawn=tournaments.some(t=>(t.entries||[]).some(e=>String(e.team_id)===String(team.id)));
  const disqualified=String(team.ban_reason||"").startsWith("Desclassificação por W.O.");
  content.innerHTML=`<header class="dialog-heading"><div><span class="section-kicker">DETALHES DA INSCRIÇÃO</span><h2>${esc(team.name)}</h2><p class="dialog-subtitle">${esc(team.modalities?.name||"Modalidade removida")} · ${esc(team.classroom||"Turma não informada")}</p></div><button type="button" class="dialog-close" data-close-team-detail aria-label="Fechar">×</button></header><div class="team-detail-dialog__members"><strong>Participantes (${members.length})</strong>${members.map(m=>`<div class="team-detail-dialog__member">${esc(m.name)} ${m.is_banned?'<b class="ban-state">BANIDO</b>':''}</div>`).join("")||"Nenhum participante informado"}</div><p>${team.is_banned?(disqualified?"Equipe desclassificada do torneio.":"Equipe banida."):"Inscrição ativa."}</p><div class="team-detail-dialog__actions"><button type="button" class="button button--outline" data-action="edit-team" data-id="${esc(team.id)}" ${drawn?"disabled title='Edição bloqueada após o sorteio'":""}>Editar inscrição</button><button type="button" class="button ${team.is_banned?"button--outline":"button--danger"}" data-action="toggle-ban-team" data-id="${esc(team.id)}">${team.is_banned?"Reativar equipe":"Banir equipe"}</button><button type="button" class="button button--danger" data-action="delete-team" data-id="${esc(team.id)}">Excluir inscrição</button></div>`;
  if(!dialog.open) dialog.showModal();
}

async function loadModalities() {
  const { data, error } = await supabase.from("modalities").select("id,name,description,participants_per_team,is_active,created_at").order("name");
  if (error) throw error;
  modalities = data || [];
  renderModalities();
  renderModalityFilter();
}
async function loadTeams() {
  const { data, error } = await supabase.from("teams").select("id,name,classroom,modality_id,created_at,is_banned,banned_at,ban_reason,modalities(name,participants_per_team),team_members(id,name,member_order,is_banned,banned_at,ban_reason)").order("created_at", { ascending: false });
  if (error) throw error;
  teams = (data || []).map((team) => ({ ...team, team_members: team.team_members || [] }));
  renderModalityFilter();
  renderTeams();
}
function parseRpcPayload(data) {
  if (typeof data === "string") {
    try { return JSON.parse(data); } catch (_) { return {}; }
  }
  return data && typeof data === "object" ? data : {};
}
function tournamentStatusLabel(status) {
  return ({ knockout: "Mata-mata em andamento", groups: "Fase de grupos", playoffs: "Mata-mata final", completed: "Campeonato encerrado" })[status] || "Preparação";
}
function formatLabel(format) {
  return format === "groups" ? "Grupos + mata-mata" : "Mata-mata direto";
}
function updateRegistrationControls() {
  const state = $("#registration-state");
  const description = $("#registration-description");
  const button = $("#toggle-registration");
  const activeTournament = tournaments.some((tournament) => tournament.status !== "completed");
  state.textContent = registrationOpen ? "Inscrições abertas" : "Inscrições encerradas";
  state.className = `tournament-status-pill ${registrationOpen ? "is-open" : "is-closed"}`;
  description.textContent = registrationOpen
    ? "Os alunos ainda podem enviar novas equipes. Encerre esta etapa quando a lista estiver pronta."
    : "Novas equipes estão bloqueadas. Você já pode sortear os confrontos de cada modalidade.";
  button.textContent = registrationOpen ? "Finalizar inscrições" : "Reabrir inscrições";
  button.disabled = !tournamentFeaturesReady || (!registrationOpen && activeTournament);
  button.classList.remove("button--dark");
  button.classList.toggle("button--danger", registrationOpen);
  button.classList.toggle("button--gold", !registrationOpen);
  $("#generate-tournament").disabled = !tournamentFeaturesReady || registrationOpen;
  const modalitySelect = $("#tournament-modality");
  const previous = modalitySelect.value;
  modalitySelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Selecione a modalidade";
  modalitySelect.append(placeholder);
  const activeModalityIds = new Set(tournaments.filter((item) => item.status !== "completed").map((item) => item.modality_id));
  modalities.forEach((modality) => {
    const count = teams.filter((team) => team.modality_id === modality.id && isTeamEligible(team)).length;
    if (count < 2 || activeModalityIds.has(modality.id)) return;
    const option = document.createElement("option");
    option.value = modality.id;
    const rosterLabel = Number(modality.participants_per_team) === 1 ? (count === 1 ? "competidor" : "competidores") : (count === 1 ? "equipe" : "equipes");
    option.textContent = `${modality.name} (${count} ${rosterLabel})`;
    modalitySelect.append(option);
  });
  if ([...modalitySelect.options].some((option) => option.value === previous)) modalitySelect.value = previous;
  if (!registrationOpen) $("#generate-tournament").disabled = !tournamentFeaturesReady || modalitySelect.options.length <= 1;
}
function adminParticipantLabel(name, classroom) {
  return classroom ? `${name || "A definir"} · Sala/turma ${classroom}` : (name || "Aguardando competidor");
}
function adminRoundLabel(round, maxRound) {
  if (round === maxRound) return "Final";
  if (round === maxRound - 1) return "Semifinal";
  if (round === maxRound - 2 && maxRound >= 3) return "Quartas de final";
  if (round === maxRound - 3 && maxRound >= 4) return "Oitavas de final";
  return round === 1 ? "Primeira rodada" : `Rodada ${round}`;
}
function adminMatchStatus(match) {
  if (match.status === "in_progress") return "Ao vivo";
  if (match.status === "completed") return "Finalizado";
  if (match.status === "bye") return "Avanço automático";
  return match.home_team_id && match.away_team_id ? "Aguardando início" : "Aguardando equipes";
}
function renderAdminBracketMatch(tournament, match, position = null, maxRound = 1) {
  const phase = match.phase === "groups"
    ? `${match.group_name || "Fase de grupos"} · Jogo ${match.match_number}`
    : `${adminRoundLabel(Number(match.round_number) || 1, maxRound)} · Jogo ${match.match_number}`;
  const hasScore = match.home_score !== null && match.home_score !== undefined && match.away_score !== null && match.away_score !== undefined;
  const homeWinner = Boolean(match.winner_team_id && String(match.winner_team_id) === String(match.home_team_id));
  const awayWinner = Boolean(match.winner_team_id && String(match.winner_team_id) === String(match.away_team_id));
  const state = match.status === "in_progress" ? "is-live" : match.status === "completed" ? "is-completed" : match.status === "bye" ? "is-bye" : "is-pending";
  const style = position ? ` style="left:${position.left}px;top:${position.top}px;width:${position.width}px"` : "";
  return `<button type="button" class="bracket-match ${state} ${position ? "is-positioned" : ""} admin-bracket-match" data-action="control-match" data-match-id="${esc(match.id)}"${style} aria-label="Abrir controle de ${esc(phase)}: ${esc(match.home_team_name || "A definir")} contra ${esc(match.away_team_name || "A definir")}">
    <span class="bracket-match__meta"><span>${esc(phase)}</span><b>${esc(adminMatchStatus(match))}</b></span>
    <span class="bracket-match__team ${homeWinner ? "is-winner" : ""}"><span><strong>${esc(match.home_team_name || "A definir")}</strong><small>${esc(match.home_classroom || "")}</small></span><b>${hasScore ? esc(match.home_score) : "–"}</b></span>
    <span class="bracket-match__team ${awayWinner ? "is-winner" : ""}"><span><strong>${esc(match.away_team_name || "A definir")}</strong><small>${esc(match.away_classroom || "")}</small></span><b>${hasScore ? esc(match.away_score) : "–"}</b></span>
    <span class="bracket-match__open">Abrir controle <i aria-hidden="true">↗</i></span>
  </button>`;
}
function renderAdminBracketTree(tournament, knockout) {
  const rounds = [...new Set(knockout.map((match) => Number(match.round_number) || 1))]
    .sort((a, b) => a - b)
    .map((number) => ({
      number,
      matches: knockout.filter((match) => (Number(match.round_number) || 1) === number)
        .sort((a, b) => Number(a.match_number) - Number(b.match_number))
    }));
  const maxRound = Math.max(1, ...rounds.map((round) => round.number));
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
  const centerY = (roundIndex, matchIndex) => (matchIndex * (2 ** roundIndex) + (2 ** (roundIndex - 1))) * ROW_HEIGHT;

  let connectors = "";
  rounds.slice(0, -1).forEach((round, roundIndex) => {
    const nextRound = rounds[roundIndex + 1];
    nextRound.matches.forEach((_, targetIndex) => {
      const targetY = HEADING_HEIGHT + centerY(roundIndex + 1, targetIndex);
      [targetIndex * 2, targetIndex * 2 + 1].forEach((sourceIndex) => {
        if (!round.matches[sourceIndex]) return;
        const startX = roundIndex * columnStep + CARD_WIDTH;
        const endX = (roundIndex + 1) * columnStep;
        const middleX = startX + (endX - startX) / 2;
        const sourceY = HEADING_HEIGHT + centerY(roundIndex, sourceIndex);
        connectors += `<path d="M ${startX} ${sourceY} H ${middleX} V ${targetY} H ${endX}"/>`;
      });
    });
  });
  const headings = rounds.map((round, index) => {
    const left = index * columnStep;
    return `<div class="bracket-round-heading ${index === rounds.length - 1 ? "is-final" : ""}" style="left:${left}px;width:${CARD_WIDTH}px"><span class="bracket-round-heading__index">${String(index + 1).padStart(2, "0")}</span><span class="bracket-round-heading__copy"><strong>${esc(adminRoundLabel(round.number, maxRound))}</strong><small>${round.matches.length} ${round.matches.length === 1 ? "partida" : "partidas"}</small></span>${index === rounds.length - 1 ? '<span class="bracket-round-heading__crown" aria-hidden="true">♛</span>' : ""}</div>`;
  }).join("");
  const cards = rounds.map((round, roundIndex) => round.matches.map((match, matchIndex) => {
    const left = roundIndex * columnStep;
    const top = HEADING_HEIGHT + centerY(roundIndex, matchIndex) - CARD_HEIGHT / 2;
    return renderAdminBracketMatch(tournament, match, { left, top, width: CARD_WIDTH }, maxRound);
  }).join("")).join("");
  const decided = knockout.filter((match) => ["completed", "bye"].includes(match.status)).length;
  return `<div class="bracket-zoom-controls" aria-label="Controles de zoom"><button type="button" data-admin-zoom="out" aria-label="Diminuir zoom">−</button><output>${Math.round(adminBracketZoom * 100)}%</output><button type="button" data-admin-zoom="in" aria-label="Aumentar zoom">+</button><button type="button" data-admin-zoom="reset">Ajustar</button></div>
    <div class="bracket-knockout__progress"><span><i class="bracket-legend-dot is-completed"></i> Finalizado</span><span><i class="bracket-legend-dot is-live"></i> Ao vivo</span><span><i class="bracket-legend-dot is-pending"></i> Aguardando</span><strong>${decided} de ${knockout.length} decididos</strong></div>
    <div class="bracket-tree-scroll" tabindex="0" role="region" aria-label="Árvore de jogos. Use a rolagem horizontal e vertical para acompanhar todas as rodadas."><div class="bracket-tree admin-public-bracket-tree" style="width:${totalWidth}px;height:${totalHeight}px;zoom:${adminBracketZoom}"><svg class="bracket-tree__connectors" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}" aria-hidden="true">${connectors}</svg>${headings}${cards}</div></div>
    <p class="bracket-tree__hint"><span aria-hidden="true">↔</span> Arraste para os lados e acompanhe o caminho até a final</p>`;
}
function renderTournamentAdminCard(tournament) {
  const matches = Array.isArray(tournament.matches) ? tournament.matches : [];
  const groupMatches = matches.filter((match) => match.phase === "groups");
  const knockoutMatches = matches.filter((match) => match.phase === "knockout");
  const allGroupsComplete = groupMatches.length > 0 && groupMatches.every((match) => ["completed", "bye"].includes(match.status));
  const canGeneratePlayoffs = tournament.format === "groups" && tournament.status === "groups" && allGroupsComplete;
  const rosterLabel = Number(tournament.participants_per_team) === 1 ? "competidores" : "equipes";
  const champion = tournament.status === "completed" && tournament.winner_team_name
    ? `<div class="bracket-champion"><span>🏆</span><div><small>CAMPEÃO DA MODALIDADE</small><strong>${esc(tournament.winner_team_name)}</strong></div></div>` : "";
  const groups = [...new Set(groupMatches.map((match) => match.group_name || "Fase de grupos"))];
  const groupSection = tournament.status === "groups" && groupMatches.length ? `<div class="bracket-groups">${groups.map((groupName) => {
    const items = groupMatches.filter((match) => (match.group_name || "Fase de grupos") === groupName).sort((a, b) => Number(a.match_number) - Number(b.match_number));
    return `<section class="bracket-group"><header><h3>${esc(groupName)}</h3><span>${items.filter((match) => match.status === "completed").length}/${items.length} jogos finalizados</span></header><div class="bracket-group__matches ${items.length > 4 ? "is-dense" : ""}">${items.map((match) => renderAdminBracketMatch(tournament, match)).join("")}</div></section>`;
  }).join("")}</div>` : "";
  const showKnockout = tournament.status !== "groups" && knockoutMatches.length > 0;
  const knockoutSection = showKnockout ? `<section class="bracket-knockout"><div class="bracket-knockout__heading"><div><span class="section-kicker">CAMINHO ATÉ O TÍTULO</span><h3>${tournament.format === "groups" ? "Mata-mata final" : "Chave eliminatória"}</h3></div><span class="bracket-knockout__subtitle">Os vencedores avançam para a próxima rodada</span></div>${renderAdminBracketTree(tournament, knockoutMatches)}</section>` : "";
  const playoffsAction = canGeneratePlayoffs ? `<div class="admin-playoffs-action"><div><strong>Fase de grupos concluída</strong><p>Os dois melhores de cada grupo avançarão. Critérios: pontos, saldo, gols marcados e nome do competidor/equipe.</p></div><button class="button button--gold" type="button" data-action="generate-playoffs" data-id="${esc(tournament.id)}">Gerar mata-mata <span>↗</span></button></div>` : (tournament.format === "groups" && tournament.status === "groups" ? `<p class="tournament-progress-hint">Inicie e finalize todos os jogos da fase de grupos para liberar a geração da fase final.</p>` : "");
  return `<article class="admin-tournament-card admin-public-tournament-card"><header class="admin-tournament-card__header"><div class="admin-tournament-mark" aria-hidden="true">${tournament.status === "completed" ? "🏆" : "⚔"}</div><div class="admin-tournament-card__title"><span class="section-kicker">${formatLabel(tournament.format)}</span><h3>${esc(tournament.modality_name)}</h3><p>${(tournament.entries || []).length} ${rosterLabel} sorteados · ${niceDate(tournament.created_at)}</p></div><span class="tournament-status-pill ${tournament.status === "completed" ? "is-complete" : "is-running"}">${tournamentStatusLabel(tournament.status)}</span></header>${champion}${groupSection}${knockoutSection}${playoffsAction}</article>`;
}
function activateAdminTournamentTab(key, focus = false) {
  activeTournamentModalityId = key;
  const host = $("#admin-tournaments-list");
  const buttons = host.querySelectorAll("[data-admin-tournament-tab]");
  buttons.forEach((button) => {
    const active = button.dataset.adminTournamentTab === key;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    button.classList.toggle("is-active", active);
    if (focus && active) button.focus();
  });
  host.querySelectorAll("[data-admin-tournament-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.adminTournamentPanel !== key;
  });
}
function renderTournamentsAdmin() {
  const host = $("#admin-tournaments-list");
  if (!host) return;
  updateRegistrationControls();
  if (!tournaments.length) {
    host.innerHTML = `<div class="tournament-admin-empty"><strong>${registrationOpen ? "Pronto para organizar o campeonato?" : "Inscrições encerradas — sorteio liberado"}</strong><p>${registrationOpen ? "Quando a lista de equipes estiver pronta, finalize as inscrições e gere o sorteio." : "Escolha uma modalidade e o formato para montar a chave de jogos."}</p></div>`;
    activeTournamentModalityId = "";
    return;
  }
  const grouped = new Map();
  tournaments.forEach((tournament) => {
    const key = String(tournament.modality_id || tournament.modality_name || "modalidade");
    if (!grouped.has(key)) grouped.set(key, { key, name: tournament.modality_name || "Modalidade", tournaments: [] });
    grouped.get(key).tournaments.push(tournament);
  });
  const groups = [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  if (!groups.some((group) => group.key === activeTournamentModalityId)) activeTournamentModalityId = groups[0].key;
  const tabs = groups.map((group, index) => {
    const active = group.key === activeTournamentModalityId;
    const matchCount = group.tournaments.reduce((sum, tournament) => sum + (tournament.matches || []).length, 0);
    return `<button type="button" role="tab" class="modality-tab ${active ? "is-active" : ""}" id="admin-tournament-tab-${index}" data-admin-tournament-tab="${esc(group.key)}" aria-controls="admin-tournament-panel-${index}" aria-selected="${active}" tabindex="${active ? "0" : "-1"}"><span class="modality-tab__icon" aria-hidden="true">${modalitySymbol({ name: group.name })}</span><span class="modality-tab__copy"><strong>${esc(group.name)}</strong><small>${matchCount} ${matchCount === 1 ? "jogo" : "jogos"}</small></span></button>`;
  }).join("");
  const panels = groups.map((group, index) => `<section class="modality-tab-panel admin-tournament-panel" role="tabpanel" id="admin-tournament-panel-${index}" data-admin-tournament-panel="${esc(group.key)}" aria-labelledby="admin-tournament-tab-${index}" ${group.key !== activeTournamentModalityId ? "hidden" : ""}>${group.tournaments.map(renderTournamentAdminCard).join("")}</section>`).join("");
  host.innerHTML = `<div class="modality-tabs modality-tabs--admin" role="tablist" aria-label="Administrar placares por modalidade">${tabs}</div><div class="modality-tab-panels admin-tournament-panels">${panels}</div>`;
  const buttons = [...host.querySelectorAll("[data-admin-tournament-tab]")];
  buttons.forEach((button, index) => {
    button.addEventListener("click", () => activateAdminTournamentTab(button.dataset.adminTournamentTab));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      activateAdminTournamentTab(buttons[next].dataset.adminTournamentTab, true);
    });
  });
}
async function loadTournamentState() {
  tournamentFeaturesReady = false;
  try {
    const { data, error } = await supabase.rpc("get_admin_tournaments");
    if (error) throw error;
    const payload = parseRpcPayload(data);
    registrationOpen = payload.registration_open !== false;
    tournaments = Array.isArray(payload.tournaments) ? payload.tournaments : [];
    tournamentFeaturesReady = true;
    clearMessage($("#tournament-form-message"));
  } catch (error) {
    console.error("Erro ao carregar o sistema de torneios:", error);
    tournaments = [];
    activeTournamentModalityId = "";
    activeTeamModalityId = "";
    registrationOpen = true;
    setMessage($("#tournament-form-message"), "O módulo de campeonato ainda não está instalado no Supabase. Execute supabase/schema.sql no SQL Editor; depois atualize esta página.", "error");
  }
  renderTournamentsAdmin();
  renderTeams();
  renderMatchController();
  setStats();
}
async function loadEverything() {
  try {
    await loadModalities();
    await loadTeams();
    setStats();
    await loadTournamentState();
  } catch (error) {
    console.error("Erro carregando dados do painel:", error);
    notify("Não foi possível atualizar os dados. Confira as políticas RLS do Supabase.");
  }
}

// Snapshot somente de leitura usado pelo gerador do relatório. Os dados completos são
// capturados do estado carregado pelo painel, sem depender dos filtros visíveis na tabela.
window.getInterclasseReportSnapshot = () => ({
  registrationOpen,
  modalities: modalities.map((modality) => ({
    id: modality.id, name: modality.name, participants_per_team: modality.participants_per_team, is_active: modality.is_active
  })),
  teams: teams.map((team) => ({
    id: team.id, name: team.name, classroom: team.classroom, created_at: team.created_at, is_banned: team.is_banned,
    modality_name: team.modalities?.name || "Modalidade não informada",
    team_members: (team.team_members || []).map((member) => ({ name: member.name, is_banned: member.is_banned }))
  })),
  tournaments: tournaments.map((tournament) => ({
    id: tournament.id, modality_name: tournament.modality_name, participants_per_team: tournament.participants_per_team,
    format: tournament.format, status: tournament.status, winner_team_name: tournament.winner_team_name,
    winner_classroom: tournament.winner_classroom, created_at: tournament.created_at, entries: tournament.entries || [],
    matches: tournament.matches || []
  }))
});

$("#toggle-registration").addEventListener("click", async () => {
  if (!supabase || !tournamentFeaturesReady) return;
  const nextOpen = !registrationOpen;
  const confirmation = nextOpen
    ? "Reabrir as inscrições? Isso permite novas equipes, mas não altera torneios já concluídos."
    : "Finalizar as inscrições? Novas equipes não poderão ser cadastradas depois desta etapa.";
  if (!window.confirm(confirmation)) return;
  const button = $("#toggle-registration");
  button.disabled = true;
  try {
    const { error } = await supabase.rpc("admin_set_registration_open", { p_open: nextOpen });
    if (error) throw error;
    await loadEverything();
    notify(nextOpen ? "Inscrições reabertas." : "Inscrições finalizadas. O sorteio está liberado.");
  } catch (error) {
    console.error(error);
    setMessage($("#tournament-form-message"), error?.message || "Não foi possível alterar o período de inscrições.", "error");
    await loadTournamentState();
  } finally {
    button.disabled = false;
  }
});

$("#generate-tournament-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage($("#tournament-form-message"));
  if (!supabase || !tournamentFeaturesReady) {
    setMessage($("#tournament-form-message"), "O módulo de torneios ainda não está configurado no Supabase.", "error");
    return;
  }
  if (registrationOpen) {
    setMessage($("#tournament-form-message"), "Finalize as inscrições antes de gerar o sorteio.", "error");
    return;
  }
  const modalityId = $("#tournament-modality").value;
  const format = $("#tournament-format").value;
  const modality = modalities.find((item) => item.id === modalityId);
  const eligibleTeams = teams.filter((team) => team.modality_id === modalityId && isTeamEligible(team));
  const count = eligibleTeams.length;
  if (!modalityId || count < 2) {
    setMessage($("#tournament-form-message"), "Selecione uma modalidade com pelo menos duas inscrições.", "error");
    return;
  }
  if (format === "groups" && count < 6) {
    setMessage($("#tournament-form-message"), "O formato grupos + mata-mata exige ao menos seis equipes nesta modalidade.", "error");
    return;
  }
  const rosterLabel = Number(modality.participants_per_team) === 1 ? "competidores" : "equipes";
  if (!window.confirm(`Sortear ${count} ${rosterLabel} de ${modality.name} em ${format === "groups" ? "fase de grupos + mata-mata" : "mata-mata direto"}? Depois do sorteio, as inscrições ficam bloqueadas para preservar a chave.`)) return;
  const button = $("#generate-tournament");
  button.disabled = true;
  try {
    const { error } = await supabase.rpc("admin_generate_tournament", { p_modality_id: modalityId, p_format: format });
    if (error) throw error;
    await loadEverything();
    notify(`Sorteio de ${modality.name} gerado com sucesso.`);
  } catch (error) {
    console.error("Erro ao sortear campeonato:", error);
    setMessage($("#tournament-form-message"), error?.message || "Não foi possível gerar o sorteio.", "error");
  } finally {
    button.disabled = false;
  }
});

function controllerStageLabel(match, tournament) {
  if (match.phase === "groups") return `${match.group_name || "Fase de grupos"} · Jogo ${match.match_number}`;
  const knockoutMatches = (tournament.matches || []).filter((item) => item.phase === "knockout");
  const maxRound = knockoutMatches.length ? Math.max(...knockoutMatches.map((item) => Number(item.round_number) || 1)) : 1;
  const round = Number(match.round_number) || 1;
  const label = round === maxRound ? "Final" : round === maxRound - 1 ? "Semifinal" : round === maxRound - 2 && maxRound >= 3 ? "Quartas de final" : round === maxRound - 3 && maxRound >= 4 ? "Oitavas de final" : round === 1 ? "Primeira rodada" : `Rodada ${round}`;
  return `${label} · Jogo ${match.match_number}`;
}
function matchHasTwoCompetitors(match) {
  return Boolean(
    match?.home_team_id &&
    match?.away_team_id &&
    String(match.home_team_id) !== String(match.away_team_id)
  );
}
function renderMatchController() {
  if (!matchControllerScreen || !controlledMatchId) return;
  const tournament = tournaments.find((item) => (item.matches || []).some((match) => String(match.id) === String(controlledMatchId)));
  const match = tournament?.matches?.find((item) => String(item.id) === String(controlledMatchId));
  if (!match || !tournament) {
    matchControllerScreen.hidden = true;
    controlledMatchId = null;
    return;
  }
  const homeName = adminParticipantLabel(match.home_team_name || "Equipe A", match.home_classroom);
  const awayName = adminParticipantLabel(match.away_team_name || "Equipe B", match.away_classroom);
  const finished = match.status === "completed";
  const live = match.status === "in_progress";
  let content = "";
  if (live) {
    const homeScore = Math.max(0, Number(match.home_score) || 0);
    const awayScore = Math.max(0, Number(match.away_score) || 0);
    const homeTeam = teams.find((team) => String(team.id) === String(match.home_team_id));
    const awayTeam = teams.find((team) => String(team.id) === String(match.away_team_id));
    const disqualifyControl = (team, side, name) => team ? `<button type="button" class="match-controller-disqualify ${team.is_banned ? "is-disqualified" : ""}" data-action="disqualify-match-team" data-match-id="${esc(match.id)}" data-team-id="${esc(team.id)}" data-side="${side}" ${team.is_banned ? "disabled" : ""}>${team.is_banned ? "Equipe desclassificada" : `Desclassificar ${esc(name)}`}</button>` : "";
    content = `<div class="match-controller-scoreboard">
      <section class="match-controller-team ${homeTeam?.is_banned ? "is-disqualified" : ""}"><span class="match-controller-team__label">EQUIPE A</span><h2>${esc(match.home_team_name || "Equipe A")}</h2><p>${esc(match.home_classroom || "Turma não informada")}</p><strong class="match-controller-score">${homeScore}</strong><div class="match-controller-points"><button type="button" class="match-controller-minus" data-action="score-point" data-side="home" data-delta="-1" data-match-id="${esc(match.id)}" ${homeScore <= 0 ? "disabled" : ""} aria-label="Retirar ponto da equipe A">−1</button><button type="button" class="match-controller-plus" data-action="score-point" data-side="home" data-delta="1" data-match-id="${esc(match.id)}">+1 PONTO</button></div><div class="match-controller-actions">${disqualifyControl(homeTeam, "home", match.home_team_name || "equipe A")}</div></section>
      <div class="match-controller-score-divider">×</div>
      <section class="match-controller-team ${awayTeam?.is_banned ? "is-disqualified" : ""}"><span class="match-controller-team__label">EQUIPE B</span><h2>${esc(match.away_team_name || "Equipe B")}</h2><p>${esc(match.away_classroom || "Turma não informada")}</p><strong class="match-controller-score">${awayScore}</strong><div class="match-controller-points"><button type="button" class="match-controller-minus" data-action="score-point" data-side="away" data-delta="-1" data-match-id="${esc(match.id)}" ${awayScore <= 0 ? "disabled" : ""} aria-label="Retirar ponto da equipe B">−1</button><button type="button" class="match-controller-plus" data-action="score-point" data-side="away" data-delta="1" data-match-id="${esc(match.id)}">+1 PONTO</button></div><div class="match-controller-actions">${disqualifyControl(awayTeam, "away", match.away_team_name || "equipe B")}</div></section>
    </div><footer class="match-controller-footer"><span class="match-controller-live"><i></i> AO VIVO · controle exclusivo desta partida</span><button type="button" class="match-controller-finish" data-action="finish-match" data-match-id="${esc(match.id)}">Encerrar partida ✓</button></footer>`;
  } else if (finished) {
    const winner = match.winner_team_id === match.home_team_id ? (match.home_team_name || "Equipe A") : match.winner_team_id === match.away_team_id ? (match.away_team_name || "Equipe B") : "Empate registrado";
    content = `<div class="match-controller-complete"><span class="match-controller-live"><i></i> RESULTADO REGISTRADO</span><strong>Partida finalizada</strong><p>${esc(homeName)} <b>${esc(match.home_score ?? 0)} × ${esc(match.away_score ?? 0)}</b> ${esc(awayName)}</p><p>${match.phase === "knockout" ? `Classificado: ${esc(winner)}` : "Resultado registrado na fase de grupos."}</p></div>`;
  } else {
    const startFeedback = matchStartFeedback?.matchId === String(match.id) ? matchStartFeedback : null;
    if (startFeedback?.state === "loading") {
      content = `<div class="match-controller-pending"><strong>Iniciando a partida…</strong><p>Aguardando a confirmação do Supabase. O placar aparecerá assim que a partida for marcada como ao vivo.</p></div>`;
    } else if (startFeedback?.state === "error") {
      content = `<div class="match-controller-pending match-controller-pending--error"><strong>Não foi possível iniciar a partida</strong><p>${esc(startFeedback.message || "O Supabase não confirmou o início da partida.")}</p><button type="button" class="match-controller-retry" data-action="start-match" data-match-id="${esc(match.id)}">Tentar novamente</button></div>`;
    } else if (matchHasTwoCompetitors(match)) {
      content = `<div class="match-controller-pending"><strong>Partida pronta para começar</strong><p>Ao abrir este controle pelo chaveamento, a partida será iniciada automaticamente.</p></div>`;
    } else {
      content = `<div class="match-controller-pending"><strong>Aguardando os dois competidores</strong><p>O placar será liberado automaticamente quando as duas equipes estiverem definidas e o organizador abrir o controle da partida.</p></div>`;
    }
  }
  const markup = `<div class="match-controller-shell"><header class="match-controller-header"><div class="match-controller-brand"><span class="match-controller-brand__mark"><img src="assets/brasao-escola.png" alt=""></span><span><strong>JOGOS</strong><small>${esc(tournament.modality_name || "Modalidade")} · ${esc(controllerStageLabel(match, tournament))}</small></span></div><button type="button" class="match-controller-close" data-close-match-controller>✕ Voltar ao painel</button></header><div class="match-controller-info"><span class="match-controller-kicker">${finished ? "JOGO ENCERRADO" : live ? "CONTROLE DE ARBITRAGEM" : "PREPARANDO O JOGO"}</span><h1>${esc(controllerStageLabel(match, tournament))}</h1><p>${esc(tournament.modality_name || "Modalidade")} · controle apenas desta partida</p></div>${content}</div>`;
  if (matchControllerScreen.innerHTML !== markup) matchControllerScreen.innerHTML = markup;
  matchControllerScreen.hidden = false;
}
function openMatchController(matchId) {
  controlledMatchId = String(matchId);
  matchControllerScreen.hidden = false;
  renderMatchController();
  // A solicitação ocorre dentro do clique do administrador, antes de qualquer await.
  try {
    const request = matchControllerScreen.requestFullscreen?.();
    if (request && typeof request.catch === "function") request.catch(() => {});
  } catch (_) { /* O painel fixo continua ocupando a janela inteira. */ }
}
function closeMatchController(exitFullscreen = true) {
  controlledMatchId = null;
  matchControllerScreen.hidden = true;
  if (exitFullscreen && document.fullscreenElement === matchControllerScreen) {
    const request = document.exitFullscreen?.();
    if (request && typeof request.catch === "function") request.catch(() => {});
  }
}
async function startPendingMatch(matchId, triggerButton = null) {
  const normalizedId = String(matchId);
  const findMatch = () => {
    const tournament = tournaments.find((item) => (item.matches || []).some((match) => String(match.id) === normalizedId));
    const match = tournament?.matches?.find((item) => String(item.id) === normalizedId);
    return { tournament, match };
  };
  let { match } = findMatch();
  if (!match || match.status !== "pending" || !matchHasTwoCompetitors(match)) return false;
  if (matchStartFeedback?.matchId === normalizedId && matchStartFeedback.state === "loading") return false;

  const originalLabel = triggerButton?.textContent;
  if (triggerButton) triggerButton.disabled = true;
  matchStartFeedback = { matchId: normalizedId, state: "loading" };
  renderMatchController();

  try {
    const { error } = await supabase.rpc("admin_start_match", { p_match_id: normalizedId });
    if (error) throw error;
    await loadTournamentState();
    ({ match } = findMatch());
    if (match?.status !== "in_progress") {
      throw new Error("O Supabase recebeu o início, mas ainda não confirmou a partida como ao vivo. Atualize os dados e tente novamente.");
    }
    matchStartFeedback = null;
    renderMatchController();
    notify("Partida iniciada automaticamente. O placar está liberado para o organizador.");
    return true;
  } catch (error) {
    console.error("Erro ao iniciar a partida ao abrir o controle:", error);
    const errorMessage = error?.message || "Não foi possível iniciar a partida. Confira a conexão e as permissões do Supabase.";

    // Outra sessão do organizador pode ter iniciado o jogo ao mesmo tempo.
    // Atualizamos novamente e aceitamos esse estado como sucesso, sem exibir erro falso.
    await loadTournamentState();
    ({ match } = findMatch());
    if (match?.status === "in_progress") {
      matchStartFeedback = null;
      renderMatchController();
      notify("Esta partida já está ao vivo. O controle do placar foi liberado.");
      return true;
    }

    matchStartFeedback = { matchId: normalizedId, state: "error", message: errorMessage };
    renderMatchController();
    notify(errorMessage);
    return false;
  } finally {
    if (triggerButton?.isConnected) {
      triggerButton.disabled = false;
      if (originalLabel !== undefined) triggerButton.textContent = originalLabel;
    }
  }
}
async function openMatchControllerForOrganizer(matchId, triggerButton = null) {
  openMatchController(matchId);
  const normalizedId = String(matchId);
  const tournament = tournaments.find((item) => (item.matches || []).some((match) => String(match.id) === normalizedId));
  const match = tournament?.matches?.find((item) => String(item.id) === normalizedId);
  if (match?.status === "pending" && matchHasTwoCompetitors(match)) {
    await startPendingMatch(normalizedId, triggerButton);
  }
}
matchControllerScreen.addEventListener("click", async (event) => {
  if (event.target.closest("[data-close-match-controller]")) {
    closeMatchController();
    return;
  }
  const button = event.target.closest('button[data-action="start-match"], button[data-action="score-point"], button[data-action="finish-match"], button[data-action="disqualify-match-team"]');
  if (button) await handleLiveMatchButton(button);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !matchControllerScreen.hidden) closeMatchController();
});
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && !matchControllerScreen.hidden) closeMatchController(false);
});

async function setMatchScoreTo(matchId, side, currentScore, targetScore) {
  const wasUninitialized = currentScore === null || currentScore === undefined;
  let current = Number(currentScore ?? 0);
  const target = Number(targetScore);
  if (!Number.isInteger(current) || current < 0 || !Number.isInteger(target) || target < 0) {
    throw new Error("O placar atual está inconsistente. Atualize os dados e tente novamente.");
  }
  const changes = Math.abs(target - current);
  if (changes > 250) throw new Error("O placar está fora do limite esperado para uma desclassificação automática.");
  const applyDelta = async (delta) => {
    const { error } = await supabase.rpc("admin_increment_match_score", {
      p_match_id: matchId,
      p_side: side,
      p_delta: delta
    });
    if (error) throw error;
  };
  // Algumas partidas novas ainda carregam placar NULL. O par +1/-1 materializa o zero
  // usando a mesma rotina validada do placar, sem depender de UPDATE direto na tabela.
  if (wasUninitialized && target === 0) {
    await applyDelta(1);
    await applyDelta(-1);
    return;
  }
  const delta = target > current ? 1 : -1;
  while (current !== target) {
    await applyDelta(delta);
    current += delta;
  }
}

async function disqualifyTeamFromTournament(button, tournament, currentMatch) {
  const teamId = String(button.dataset.teamId || "");
  const team = teams.find((item) => String(item.id) === teamId);
  if (!team || !teamId) {
    notify("Não foi possível localizar a equipe para desclassificação.");
    return;
  }
  if (team.is_banned) {
    notify("Esta equipe já está desclassificada.");
    return;
  }

  // Em fase de grupos, os jogos ainda não disputados dessa equipe também recebem W.O.
  // Assim a equipe não permanece em confrontos pendentes depois da desclassificação.
  const affectedMatches = (tournament.matches || [])
    .filter((item) => {
      const includesTeam = String(item.home_team_id) === teamId || String(item.away_team_id) === teamId;
      return includesTeam && ["pending", "in_progress"].includes(item.status) && item.status !== "bye";
    })
    .sort((a, b) => {
      if (String(a.id) === String(currentMatch.id)) return -1;
      if (String(b.id) === String(currentMatch.id)) return 1;
      return Number(a.match_number || 0) - Number(b.match_number || 0);
    });

  if (!affectedMatches.length) {
    notify("Não há partidas pendentes para desclassificar nesta modalidade.");
    return;
  }
  const incomplete = affectedMatches.find((item) => {
    const opposingTeamId = String(item.home_team_id) === teamId ? item.away_team_id : item.home_team_id;
    return !opposingTeamId;
  });
  if (incomplete) {
    notify("Uma das partidas futuras ainda não tem adversário definido. Atualize o chaveamento antes de desclassificar.");
    return;
  }

  const confirmation = window.confirm(
    `Desclassificar “${team.name}” de ${tournament.modality_name}? ${affectedMatches.length} ${affectedMatches.length === 1 ? "partida pendente será encerrada" : "partidas pendentes serão encerradas"} por W.O. com vitória de 1 × 0 para cada adversário. A equipe também ficará inelegível para novos sorteios.`
  );
  if (!confirmation) return;

  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Aplicando desclassificação…";
  try {
    for (const item of affectedMatches) {
      const disqualifiedSide = String(item.home_team_id) === teamId ? "home" : "away";
      const winnerSide = disqualifiedSide === "home" ? "away" : "home";

      if (item.status === "pending") {
        const { error } = await supabase.rpc("admin_start_match", { p_match_id: item.id });
        if (error) throw error;
      }

      await setMatchScoreTo(item.id, disqualifiedSide, item[`${disqualifiedSide}_score`], 0);
      await setMatchScoreTo(item.id, winnerSide, item[`${winnerSide}_score`], 1);

      const { error: finishError } = await supabase.rpc("admin_finish_match", { p_match_id: item.id });
      if (finishError) throw finishError;
    }

    const reason = `Desclassificação por W.O. em ${tournament.modality_name}`;
    const { error: banError } = await supabase.from("teams").update({
      is_banned: true,
      banned_at: new Date().toISOString(),
      ban_reason: reason
    }).eq("id", team.id);
    if (banError) throw banError;

    await loadEverything();
    notify(`${team.name} desclassificada. ${affectedMatches.length} ${affectedMatches.length === 1 ? "resultado foi registrado" : "resultados foram registrados"} por W.O.`);
  } catch (error) {
    console.error("Erro ao desclassificar equipe:", error);
    await loadEverything();
    notify(error?.message || "Não foi possível concluir a desclassificação. Confira os resultados atualizados antes de tentar novamente.");
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

async function handleLiveMatchButton(liveButton) {
  if (!supabase || !tournamentFeaturesReady) return;
  const action = liveButton.dataset.action;
  const matchId = liveButton.dataset.matchId;
  const tournament = tournaments.find((item) => (item.matches || []).some((match) => String(match.id) === String(matchId)));
  const match = tournament?.matches?.find((item) => String(item.id) === String(matchId));
  if (!match || !tournament) return;
  if (action === "disqualify-match-team") {
    await disqualifyTeamFromTournament(liveButton, tournament, match);
    return;
  }
  if (action === "control-match") {
    await openMatchControllerForOrganizer(matchId, liveButton);
    return;
  }
  if (action === "start-match") {
    openMatchController(matchId);
    await startPendingMatch(matchId, liveButton);
    return;
  }
  if (action === "finish-match" && match.phase === "knockout" && Number(match.home_score) === Number(match.away_score)) {
    notify("No mata-mata, encerre o jogo somente depois de definir o vencedor e o placar final.");
    return;
  }
  const originalLabel = liveButton.textContent;
  liveButton.disabled = true;
  if (action === "finish-match") liveButton.textContent = "Encerrando…";
  try {
    let result;
    if (action === "score-point") {
      result = await supabase.rpc("admin_increment_match_score", { p_match_id: matchId, p_side: liveButton.dataset.side, p_delta: Number(liveButton.dataset.delta || 1) });
    } else if (action === "finish-match") {
      result = await supabase.rpc("admin_finish_match", { p_match_id: matchId });
    } else return;
    if (result?.error) throw result.error;
    await loadTournamentState();
    if (action === "score-point") notify("Placar atualizado.");
    else notify(match.phase === "knockout" ? "Partida encerrada. O vencedor avançou na chave." : "Partida encerrada. A classificação dos grupos foi atualizada.");
  } catch (error) {
    console.error("Erro ao controlar placar ao vivo:", error);
    const errorMessage = error?.message || "Não foi possível atualizar esta partida. Confira a conexão com o Supabase.";
    notify(errorMessage);
    await loadTournamentState();
  } finally {
    if (liveButton.isConnected) {
      liveButton.disabled = false;
      liveButton.textContent = originalLabel;
    }
  }
}

$("#admin-tournaments-list").addEventListener("click", async (event) => {
  const zoomButton = event.target.closest("[data-admin-zoom]");
  if (zoomButton) { const action=zoomButton.dataset.adminZoom; adminBracketZoom=action==="reset"?1:Math.max(.55,Math.min(1.5,adminBracketZoom+(action==="in"?.1:-.1))); const section=zoomButton.closest(".bracket-knockout"); const tree=section?.querySelector(".admin-public-bracket-tree"); if(tree) tree.style.zoom=String(adminBracketZoom); const out=zoomButton.parentElement.querySelector("output"); if(out) out.textContent=`${Math.round(adminBracketZoom*100)}%`; return; }
  const liveButton = event.target.closest('button[data-action="start-match"], button[data-action="control-match"], button[data-action="score-point"], button[data-action="finish-match"]');
  if (liveButton) {
    await handleLiveMatchButton(liveButton);
    return;
  }
  const matchCard = event.target.closest(".admin-match[data-match-id]");
  if (matchCard && !event.target.closest("button")) {
    const matchId = matchCard.dataset.matchId;
    const tournament = tournaments.find((item) => (item.matches || []).some((match) => String(match.id) === String(matchId)));
    const match = tournament?.matches?.find((item) => String(item.id) === String(matchId));
    if (match) await openMatchControllerForOrganizer(matchId);
    return;
  }
  const button = event.target.closest('button[data-action="generate-playoffs"]');
  if (!button || !supabase) return;
  const tournament = tournaments.find((item) => item.id === button.dataset.id);
  if (!tournament || !window.confirm(`Gerar a fase final de ${tournament.modality_name}? Os dois melhores de cada grupo serão sorteados contra equipes de outros grupos.`)) return;
  button.disabled = true;
  try {
    const { error } = await supabase.rpc("admin_generate_playoffs", { p_tournament_id: tournament.id });
    if (error) throw error;
    await loadEverything();
    notify("Mata-mata gerado. Selecione uma partida para controlar o placar.");
  } catch (error) {
    console.error(error);
    notify(error?.message || "Não foi possível gerar o mata-mata.");
  } finally {
    button.disabled = false;
  }
});
$("#admin-tournaments-list").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest(".admin-match[data-match-id]");
  if (!card || event.target.closest("button")) return;
  event.preventDefault();
  card.click();
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage(loginMessage);

  if (!isSupabaseConfigured()) {
    setMessage(loginMessage, "O login ainda não está conectado. Preencha supabaseUrl e supabaseKey em js/config.js com os dados do seu projeto Supabase.", "error");
    return;
  }
  if (!loginForm.reportValidity()) return;

  const email = $("#admin-email").value.trim().toLowerCase();
  const password = passwordInput.value;
  if (!email || !password) {
    setMessage(loginMessage, "Informe o e-mail e a senha do administrador.", "error");
    return;
  }

  setLoginLoading(true);
  try {
    supabase = await getSupabase();
    if (!supabase) throw new Error("Não foi possível iniciar o cliente do Supabase. Confira js/config.js.");

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!data?.user) throw new Error("O Supabase não retornou um usuário válido. Tente entrar novamente.");
    await enterDashboard(data.user);
  } catch (error) {
    console.error("Erro de login:", error);
    setMessage(loginMessage, friendlyAuthError(error), "error");
  } finally {
    setLoginLoading(false);
  }
});

modalityForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage(modalityMessage);
  if (!supabase) {
    setMessage(modalityMessage, "Faça login com uma conta de administrador para cadastrar modalidades.", "error");
    return;
  }
  if (!modalityForm.reportValidity()) return;
  const id = $("#modality-edit-id").value;
  const payload = {
    name: $("#modality-name").value.trim(),
    description: $("#modality-description").value.trim() || null,
    participants_per_team: Number($("#modality-size").value),
    is_active: $("#modality-active").checked
  };
  if (!payload.name || !Number.isInteger(payload.participants_per_team) || payload.participants_per_team < 1 || payload.participants_per_team > 50) {
    setMessage(modalityMessage, "Informe um nome e uma quantidade de participantes entre 1 e 50.", "error");
    return;
  }
  const saveButton = $("#save-modality");
  saveButton.disabled = true;
  try {
    const query = id ? supabase.from("modalities").update(payload).eq("id", id) : supabase.from("modalities").insert(payload);
    const { error } = await query;
    if (error) throw error;
    resetModalityForm();
    await loadEverything();
    notify(id ? "Modalidade atualizada!" : "Modalidade cadastrada!");
  } catch (error) {
    console.error("Erro ao salvar modalidade:", error);
    setMessage(modalityMessage, error?.message || "Não foi possível salvar a modalidade.", "error");
  } finally {
    saveButton.disabled = false;
  }
});

$("#cancel-modality-edit").addEventListener("click", resetModalityForm);
modalityList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const modality = modalities.find((item) => item.id === button.dataset.id);
  if (!modality) return;
  const action = button.dataset.action;
  if (action === "edit-modality") {
    $("#modality-edit-id").value = modality.id;
    $("#modality-name").value = modality.name;
    $("#modality-description").value = modality.description || "";
    $("#modality-size").value = modality.participants_per_team;
    $("#modality-active").checked = modality.is_active;
    $("#modality-form-title").textContent = "Editar modalidade";
    $("#save-modality").innerHTML = "Salvar alterações <span>↗</span>";
    $("#cancel-modality-edit").hidden = false;
    clearMessage(modalityMessage);
    modalityForm.scrollIntoView({ behavior: "smooth", block: "center" });
    $("#modality-name").focus({ preventScroll: true });
    return;
  }
  if (action === "toggle-modality") {
    try {
      const { error } = await supabase.from("modalities").update({ is_active: !modality.is_active }).eq("id", modality.id);
      if (error) throw error;
      await loadEverything();
      notify(modality.is_active ? "Inscrições pausadas para esta modalidade." : "Inscrições reabertas para esta modalidade.");
    } catch (error) {
      console.error(error);
      notify("Não foi possível alterar o status desta modalidade.");
    }
    return;
  }
  if (action === "delete-modality") {
    const hasTeams = teams.some((team) => team.modality_id === modality.id);
    const detail = hasTeams ? " Existem equipes inscritas nela; exclua essas inscrições antes de remover a modalidade." : "";
    if (!window.confirm(`Excluir a modalidade “${modality.name}”?${detail}`)) return;
    try {
      const { error } = await supabase.from("modalities").delete().eq("id", modality.id);
      if (error) throw error;
      await loadEverything();
      notify("Modalidade excluída.");
    } catch (error) {
      console.error(error);
      notify(/foreign key|violates/i.test(error?.message || "") ? "Esta modalidade ainda tem equipes vinculadas. Exclua as equipes primeiro." : (error?.message || "Não foi possível excluir a modalidade."));
    }
  }
});

function appendTeamEditorMember(member = null) {
  const host = $("#team-editor-members");
  const row = document.createElement("div");
  row.className = "team-editor-member";
  row.innerHTML = `<div class="participant-field"><label class="participant-label">Participante</label><input class="admin-edit-member-input" type="text" maxlength="100" data-member-id="${esc(member?.id || "")}" value="${esc(member?.name || "")}" required aria-label="Nome do participante"></div><button type="button" class="team-editor-member__remove" aria-label="Remover participante" title="Remover participante">×</button>`;
  row.querySelector(".team-editor-member__remove").addEventListener("click", () => row.remove());
  host.append(row);
}
function openTeamEditor(team) {
  if (!team || !teamEditorDialog) return;
  $("#team-editor-id").value = team.id;
  $("#team-editor-name").value = team.name || "";
  $("#team-editor-classroom").value = team.classroom || "";
  const modalitySelect = $("#team-editor-modality");
  modalitySelect.replaceChildren();
  modalities.forEach((modality) => {
    const option = document.createElement("option");
    option.value = modality.id;
    option.textContent = `${modality.name} · ${modality.participants_per_team} ${Number(modality.participants_per_team) === 1 ? "participante" : "participantes"}${modality.is_active ? "" : " (pausada)"}`;
    modalitySelect.append(option);
  });
  modalitySelect.value = team.modality_id;
  const membersHost = $("#team-editor-members");
  membersHost.replaceChildren();
  [...(team.team_members || [])].sort((a, b) => (a.member_order || 0) - (b.member_order || 0)).forEach((member) => appendTeamEditorMember(member));
  if (!(team.team_members || []).length) appendTeamEditorMember();
  clearMessage($("#team-editor-message"));
  teamEditorDialog.showModal();
  $("#team-editor-name").focus({ preventScroll: true });
}
$("#add-team-member").addEventListener("click", () => appendTeamEditorMember());
teamEditorDialog.addEventListener("click", (event) => {
  if (event.target === teamEditorDialog || event.target.closest("[data-close-team-editor]")) teamEditorDialog.close();
});
teamEditorForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const teamId = $("#team-editor-id").value;
  const team = teams.find((item) => item.id === teamId);
  if (!team || !supabase) return;
  const newName = $("#team-editor-name").value.trim();
  const newClassroom = $("#team-editor-classroom").value.trim();
  const newModalityId = $("#team-editor-modality").value;
  const newMembers = $$(".admin-edit-member-input", $("#team-editor-members")).map((input) => ({ id: input.dataset.memberId || "", name: input.value.trim() }));
  const modality = modalities.find((item) => item.id === newModalityId);
  if (!newName || !newClassroom || !modality) {
    setMessage($("#team-editor-message"), "Preencha o nome, a turma e a modalidade.", "error");
    return;
  }
  if (newMembers.length !== Number(modality.participants_per_team) || newMembers.some((member) => !member.name)) {
    setMessage($("#team-editor-message"), `A modalidade ${modality.name} exige exatamente ${modality.participants_per_team} ${Number(modality.participants_per_team) === 1 ? "participante" : "participantes"}. Preencha ou remova os campos para ajustar a quantidade.`, "error");
    return;
  }
  const alreadyDrawn = tournaments.some((tournament) => (tournament.entries || []).some((entry) => String(entry.team_id) === String(team.id)));
  if (alreadyDrawn) {
    setMessage($("#team-editor-message"), "Esta inscrição já faz parte de um sorteio. A edição de nome, turma, modalidade ou elenco está bloqueada para preservar os resultados. Você ainda pode registrar uma sanção pela lista de inscrições.", "error");
    return;
  }
  const saveButton = $("#save-team-edits");
  saveButton.disabled = true;
  saveButton.textContent = "Salvando…";
  try {
    const { error: teamError } = await supabase.from("teams").update({ name: newName, classroom: newClassroom, modality_id: newModalityId }).eq("id", team.id);
    if (teamError) throw teamError;
    const currentMembers = team.team_members || [];
    const submittedIds = new Set(newMembers.filter((member) => member.id).map((member) => member.id));
    const retained = currentMembers.filter((member) => submittedIds.has(member.id));
    for (const oldMember of currentMembers) {
      if (!submittedIds.has(oldMember.id)) {
        const { error } = await supabase.from("team_members").delete().eq("id", oldMember.id).eq("team_id", team.id);
        if (error) throw error;
      }
    }
    for (const member of newMembers) {
      if (member.id && currentMembers.some((old) => old.id === member.id)) {
        const { error } = await supabase.from("team_members").update({ name: member.name }).eq("id", member.id).eq("team_id", team.id);
        if (error) throw error;
      }
    }
    const usedOrders = new Set(retained.map((member) => Number(member.member_order)));
    const newRows = newMembers.filter((member) => !member.id);
    const inserts = [];
    for (const member of newRows) {
      let order = 1;
      while (usedOrders.has(order) && order <= 50) order += 1;
      if (order > 50) throw new Error("Não há posições disponíveis para adicionar mais participantes.");
      usedOrders.add(order);
      inserts.push({ team_id: team.id, name: member.name, member_order: order });
    }
    if (inserts.length) {
      const { error } = await supabase.from("team_members").insert(inserts);
      if (error) throw error;
    }
    teamEditorDialog.close();
    await loadEverything();
    notify("Inscrição atualizada com sucesso.");
  } catch (error) {
    console.error("Erro ao editar inscrição:", error);
    setMessage($("#team-editor-message"), error?.message || "Não foi possível salvar a inscrição.", "error");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Salvar alterações ↗";
  }
});

teamTableWrap.addEventListener("click", async (event) => {
  if (event.target.closest("[data-close-team-detail]")) { $("#team-detail-dialog",teamTableWrap)?.close(); return; }
  const teamCard=event.target.closest("[data-open-team]"); if(teamCard){ openTeamDetails(teamCard.dataset.openTeam); return; }
  const button = event.target.closest("button[data-action]");
  if (!button || !supabase) return;
  const action = button.dataset.action;
  const team = teams.find((item) => item.id === button.dataset.id || item.id === button.dataset.teamId);
  if (action === "edit-team") {
    $("#team-detail-dialog",teamTableWrap)?.close();
    if (team) openTeamEditor(team);
    return;
  }
  if (action === "delete-team" && team) {
    if (!window.confirm(`Excluir a inscrição “${team.name}” e seus participantes? Essa ação não pode ser desfeita. Se a equipe já estiver em uma chave, o banco impedirá a exclusão para preservar o campeonato.`)) return;
    button.disabled = true;
    try {
      const { error } = await supabase.from("teams").delete().eq("id", team.id);
      if (error) throw error;
      await loadEverything();
      notify("Inscrição excluída.");
    } catch (error) {
      console.error(error);
      notify(error?.message || "Não foi possível excluir. Equipes sorteadas não podem ser removidas.");
    } finally { button.disabled = false; }
    return;
  }
  if (action === "delete-member" && team) {
    const member = (team.team_members || []).find((item) => String(item.id) === String(button.dataset.memberId));
    if (!member) return;
    const alreadyDrawn = tournaments.some((tournament) => (tournament.entries || []).some((entry) => String(entry.team_id) === String(team.id)));
    if (alreadyDrawn) {
      notify("Este participante faz parte de uma chave já sorteada. A exclusão foi bloqueada para preservar os resultados.");
      return;
    }
    if (!window.confirm(`Excluir o participante “${member.name}” da inscrição “${team.name}”?`)) return;
    button.disabled = true;
    try {
      const { error } = await supabase.from("team_members").delete().eq("id", member.id).eq("team_id", team.id);
      if (error) throw error;
      await loadEverything();
      notify("Participante excluído da inscrição.");
    } catch (error) {
      console.error(error);
      notify(error?.message || "Não foi possível excluir o participante.");
    } finally { button.disabled = false; }
    return;
  }
  if (action === "toggle-ban-team" && team) {
    const willBan = !team.is_banned;
    const reason = willBan ? window.prompt(`Motivo do banimento de “${team.name}” (opcional):`, "") : null;
    if (willBan && reason === null) return;
    if (!window.confirm(willBan ? `Banir “${team.name}”? A inscrição ficará fora de novos sorteios. Uma chave já criada não será refeita automaticamente.` : `Retirar o banimento de “${team.name}”? Ela poderá entrar em novos sorteios se todos os participantes estiverem liberados.`)) return;
    button.disabled = true;
    try {
      const { error } = await supabase.from("teams").update({ is_banned: willBan, banned_at: willBan ? new Date().toISOString() : null, ban_reason: willBan ? (reason.trim() || null) : null }).eq("id", team.id);
      if (error) throw error;
      await loadEverything();
      notify(willBan ? "Equipe banida e retirada dos próximos sorteios." : "Banimento da equipe removido.");
    } catch (error) {
      console.error(error);
      notify(error?.message || "Não foi possível alterar o banimento da equipe.");
    } finally { button.disabled = false; }
    return;
  }
  if (action === "toggle-ban-member" && team) {
    const member = (team.team_members || []).find((item) => String(item.id) === String(button.dataset.memberId));
    if (!member) return;
    const willBan = !member.is_banned;
    const reason = willBan ? window.prompt(`Motivo do banimento de “${member.name}” (opcional):`, "") : null;
    if (willBan && reason === null) return;
    if (!window.confirm(willBan ? `Banir o participante “${member.name}”? A inscrição ficará fora de novos sorteios até o banimento ser removido. Uma chave já criada não será refeita automaticamente.` : `Reativar “${member.name}” para permitir que a inscrição participe de novos sorteios?`)) return;
    button.disabled = true;
    try {
      const { error } = await supabase.from("team_members").update({ is_banned: willBan, banned_at: willBan ? new Date().toISOString() : null, ban_reason: willBan ? (reason.trim() || null) : null }).eq("id", member.id).eq("team_id", team.id);
      if (error) throw error;
      await loadEverything();
      notify(willBan ? "Participante banido; a inscrição fica fora de novos sorteios." : "Participante reativado.");
    } catch (error) {
      console.error(error);
      notify(error?.message || "Não foi possível alterar o banimento do participante.");
    } finally { button.disabled = false; }
  }
});

$("#team-search").addEventListener("input", renderTeams);
$("#refresh-teams").addEventListener("click", async () => {
  await loadEverything();
  notify("Lista atualizada.");
});
$("#logout-button").addEventListener("click", async () => {
  try { if (supabase) await supabase.auth.signOut(); }
  finally {
    teams = [];
    modalities = [];
    tournaments = [];
    activeTournamentModalityId = "";
    activeTeamModalityId = "";
    registrationOpen = true;
    tournamentFeaturesReady = false;
    resetModalityForm();
    closeMatchController();
    if (teamEditorDialog.open) teamEditorDialog.close();
    showLogin();
    setMessage(loginMessage, "Você saiu do painel com segurança.", "info");
  }
});

async function init() {
  if (!isSupabaseConfigured()) {
    $("#setup-banner").hidden = false;
    setMessage(loginMessage, "Configuração necessária: adicione a URL e a chave pública do Supabase em js/config.js. Depois, confirme que a conta foi criada em Authentication e incluída na tabela admin_users.", "info");
    return;
  }
  try {
    supabase = await getSupabase();
    if (!supabase) throw new Error("Cliente do Supabase indisponível.");
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session?.user) await enterDashboard(data.session.user);
  } catch (error) {
    console.error("Falha ao inicializar painel:", error);
    setMessage(loginMessage, friendlyAuthError(error), "error");
  }
}

init();
window.setInterval(() => {
  if (dashboard && !dashboard.hidden && supabase && tournamentFeaturesReady && document.visibilityState === "visible") {
    loadTournamentState();
  }
}, 5000);
