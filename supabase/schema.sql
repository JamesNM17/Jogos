-- ============================================================================
-- JOGOS - Escola Estadual Brigadeiro Gavião Peixoto
-- Schema para Supabase / PostgreSQL
-- Execute este arquivo uma única vez no SQL Editor do Supabase.
-- O script pode ser executado novamente sem apagar os dados existentes.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Tabelas principais
-- ---------------------------------------------------------------------------

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.modalities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  participants_per_team integer not null check (participants_per_team between 1 and 50),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  classroom text,
  modality_id uuid not null references public.modalities(id) on delete restrict,
  created_at timestamptz not null default now(),
  is_banned boolean not null default false,
  banned_at timestamptz,
  ban_reason text
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  member_order integer not null default 1 check (member_order > 0),
  is_banned boolean not null default false,
  banned_at timestamptz,
  ban_reason text,
  created_at timestamptz not null default now(),
  unique (team_id, member_order)
);

create table if not exists public.app_settings (
  id smallint primary key default 1 check (id = 1),
  registration_open boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id, registration_open)
values (1, true)
on conflict (id) do nothing;

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  modality_id uuid not null references public.modalities(id) on delete restrict,
  format text not null check (format in ('knockout', 'groups')),
  status text not null check (status in ('knockout', 'groups', 'playoffs', 'completed')),
  participants_per_team integer not null check (participants_per_team between 1 and 50),
  winner_team_id uuid references public.teams(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.tournament_entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete restrict,
  group_name text,
  seed integer not null default 1,
  created_at timestamptz not null default now(),
  unique (tournament_id, team_id)
);

create table if not exists public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  phase text not null check (phase in ('groups', 'knockout')),
  group_name text,
  round_number integer not null default 1 check (round_number > 0),
  match_number integer not null check (match_number > 0),
  home_team_id uuid references public.teams(id) on delete set null,
  away_team_id uuid references public.teams(id) on delete set null,
  home_score integer check (home_score is null or home_score >= 0),
  away_score integer check (away_score is null or away_score >= 0),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'bye')),
  winner_team_id uuid references public.teams(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (tournament_id, phase, round_number, match_number),
  check (home_team_id is null or away_team_id is null or home_team_id <> away_team_id)
);

create index if not exists idx_teams_modality on public.teams(modality_id);
create index if not exists idx_team_members_team on public.team_members(team_id, member_order);
create index if not exists idx_tournaments_modality on public.tournaments(modality_id, created_at desc);
create index if not exists idx_tournament_entries_tournament on public.tournament_entries(tournament_id, group_name, seed);
create index if not exists idx_tournament_matches_tournament on public.tournament_matches(tournament_id, phase, round_number, match_number);
create unique index if not exists idx_teams_unique_name_per_modality
  on public.teams(modality_id, lower(btrim(name)));

-- ---------------------------------------------------------------------------
-- 2. Autorização e Row Level Security
-- ---------------------------------------------------------------------------

create or replace function public.has_admin_role()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.user_id = (select auth.uid())
  );
$$;

revoke all on function public.has_admin_role() from public;
grant execute on function public.has_admin_role() to anon, authenticated;

alter table public.admin_users enable row level security;
alter table public.modalities enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.app_settings enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.tournament_matches enable row level security;

drop policy if exists "admin can read own admin row" on public.admin_users;
create policy "admin can read own admin row"
  on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "public reads active modalities and admins read all" on public.modalities;
create policy "public reads active modalities and admins read all"
  on public.modalities for select to anon, authenticated
  using (is_active or public.has_admin_role());

drop policy if exists "admins manage modalities" on public.modalities;
create policy "admins manage modalities"
  on public.modalities for all to authenticated
  using (public.has_admin_role())
  with check (public.has_admin_role());

drop policy if exists "admins manage teams" on public.teams;
create policy "admins manage teams"
  on public.teams for all to authenticated
  using (public.has_admin_role())
  with check (public.has_admin_role());

drop policy if exists "admins manage team members" on public.team_members;
create policy "admins manage team members"
  on public.team_members for all to authenticated
  using (public.has_admin_role())
  with check (public.has_admin_role());

-- As demais tabelas são acessadas apenas por funções RPC SECURITY DEFINER.
-- Não há políticas diretas para visitantes nem para o cliente autenticado.

revoke all on public.admin_users, public.modalities, public.teams, public.team_members,
  public.app_settings, public.tournaments, public.tournament_entries, public.tournament_matches
  from anon, authenticated;

grant select on public.admin_users to authenticated;
grant select on public.modalities to anon, authenticated;
grant insert, update, delete on public.modalities to authenticated;
grant select, insert, update, delete on public.teams, public.team_members to authenticated;

-- ---------------------------------------------------------------------------
-- 3. RPC de inscrição pública
-- ---------------------------------------------------------------------------

create or replace function public.register_team(
  p_modality_id uuid,
  p_team_name text,
  p_classroom text,
  p_members jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_modality public.modalities%rowtype;
  v_expected integer;
  v_count integer;
  v_team_name text;
  v_team_id uuid;
  v_member jsonb;
  v_order integer := 0;
begin
  select * into v_modality
  from public.modalities
  where id = p_modality_id and is_active = true;

  if not found then
    raise exception 'A modalidade não está recebendo inscrições.';
  end if;

  if not coalesce((select registration_open from public.app_settings where id = 1), true) then
    raise exception 'As inscrições foram encerradas pela organização.';
  end if;

  if jsonb_typeof(p_members) is distinct from 'array' then
    raise exception 'Envie a lista de participantes em formato válido.';
  end if;

  v_expected := v_modality.participants_per_team;
  v_count := jsonb_array_length(p_members);
  if v_count <> v_expected then
    raise exception 'A modalidade exige exatamente % participantes; foram informados %.', v_expected, v_count;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_members) x
    where nullif(btrim(x.value ->> 'name'), '') is null
  ) then
    raise exception 'Preencha o nome de todos os participantes.';
  end if;

  if v_expected = 1 then
    select btrim(p_members -> 0 ->> 'name') into v_team_name;
  else
    v_team_name := nullif(btrim(coalesce(p_team_name, '')), '');
  end if;

  if v_team_name is null then
    raise exception 'Informe o nome da equipe.';
  end if;

  if exists (
    select 1 from public.teams t
    where t.modality_id = p_modality_id and lower(btrim(t.name)) = lower(btrim(v_team_name))
  ) then
    raise exception 'Já existe uma equipe com esse nome nesta modalidade.';
  end if;

  insert into public.teams (name, classroom, modality_id)
  values (v_team_name, nullif(btrim(coalesce(p_classroom, '')), ''), p_modality_id)
  returning id into v_team_id;

  for v_member in select value from jsonb_array_elements(p_members)
  loop
    v_order := v_order + 1;
    insert into public.team_members (team_id, name, member_order)
    values (v_team_id, btrim(v_member ->> 'name'), v_order);
  end loop;

  return v_team_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Funções internas para montar e avançar o chaveamento
-- ---------------------------------------------------------------------------

create or replace function public._propagate_knockout_result(
  p_tournament_id uuid,
  p_round_number integer,
  p_match_number integer,
  p_winner_team_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_next public.tournament_matches%rowtype;
  v_feed_one_status text;
  v_feed_two_status text;
  v_resolved boolean;
  v_winner uuid;
begin
  select * into v_next
  from public.tournament_matches
  where tournament_id = p_tournament_id
    and phase = 'knockout'
    and round_number = p_round_number + 1
    and match_number = ceil(p_match_number::numeric / 2)::integer;

  if not found then
    return;
  end if;

  if mod(p_match_number, 2) = 1 then
    update public.tournament_matches
    set home_team_id = p_winner_team_id
    where id = v_next.id;
  else
    update public.tournament_matches
    set away_team_id = p_winner_team_id
    where id = v_next.id;
  end if;

  select
    bool_and(status in ('completed', 'bye')),
    max(status) filter (where match_number = (v_next.match_number * 2) - 1),
    max(status) filter (where match_number = (v_next.match_number * 2))
  into v_resolved, v_feed_one_status, v_feed_two_status
  from public.tournament_matches
  where tournament_id = p_tournament_id
    and phase = 'knockout'
    and round_number = p_round_number
    and match_number in ((v_next.match_number * 2) - 1, v_next.match_number * 2);

  if coalesce(v_resolved, false) then
    select home_team_id, away_team_id
    into v_next.home_team_id, v_next.away_team_id
    from public.tournament_matches
    where id = v_next.id;

    if v_next.home_team_id is null or v_next.away_team_id is null then
      v_winner := coalesce(v_next.home_team_id, v_next.away_team_id);
      update public.tournament_matches
      set status = 'bye', winner_team_id = v_winner, finished_at = now()
      where id = v_next.id;
      perform public._propagate_knockout_result(
        p_tournament_id, v_next.round_number, v_next.match_number, v_winner
      );
    else
      update public.tournament_matches
      set status = 'pending', winner_team_id = null
      where id = v_next.id and status = 'bye';
    end if;
  end if;
end;
$$;

create or replace function public._create_knockout_bracket(
  p_tournament_id uuid,
  p_team_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_team_count integer := coalesce(array_length(p_team_ids, 1), 0);
  v_size integer := 1;
  v_rounds integer := 0;
  v_round integer;
  v_match_count integer;
  v_match integer;
  v_home uuid;
  v_away uuid;
  v_match_id uuid;
begin
  if v_team_count < 2 then
    raise exception 'São necessárias pelo menos duas equipes para gerar o mata-mata.';
  end if;

  while v_size < v_team_count loop
    v_size := v_size * 2;
  end loop;
  v_rounds := trunc(ln(v_size::numeric) / ln(2::numeric))::integer;

  for v_round in 1..v_rounds loop
    v_match_count := (v_size / power(2, v_round))::integer;
    for v_match in 1..v_match_count loop
      insert into public.tournament_matches (
        tournament_id, phase, round_number, match_number, status
      ) values (
        p_tournament_id, 'knockout', v_round, v_match, 'pending'
      );
    end loop;
  end loop;

  for v_match in 1..(v_size / 2) loop
    v_home := case when (v_match * 2 - 1) <= v_team_count then p_team_ids[v_match * 2 - 1] else null end;
    v_away := case when (v_match * 2) <= v_team_count then p_team_ids[v_match * 2] else null end;

    update public.tournament_matches
    set home_team_id = v_home,
        away_team_id = v_away,
        status = case when v_home is null or v_away is null then 'bye' else 'pending' end,
        winner_team_id = case when v_home is null or v_away is null then coalesce(v_home, v_away) else null end,
        finished_at = case when v_home is null or v_away is null then now() else null end
    where tournament_id = p_tournament_id
      and phase = 'knockout'
      and round_number = 1
      and match_number = v_match
    returning id into v_match_id;
  end loop;

  -- Propaga as vagas automáticas de todas as partidas de abertura.
  for v_match in 1..(v_size / 2) loop
    select winner_team_id into v_home
    from public.tournament_matches
    where tournament_id = p_tournament_id and phase = 'knockout'
      and round_number = 1 and match_number = v_match and status = 'bye';
    if found then
      perform public._propagate_knockout_result(p_tournament_id, 1, v_match, v_home);
    end if;
  end loop;
end;
$$;

create or replace function public._finish_tournament_if_done(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_last_round integer;
  v_final public.tournament_matches%rowtype;
begin
  select max(round_number) into v_last_round
  from public.tournament_matches
  where tournament_id = p_tournament_id and phase = 'knockout';

  if v_last_round is null then return; end if;

  if exists (
    select 1 from public.tournament_matches
    where tournament_id = p_tournament_id and phase = 'knockout'
      and round_number = v_last_round and status not in ('completed', 'bye')
  ) then
    return;
  end if;

  select * into v_final
  from public.tournament_matches
  where tournament_id = p_tournament_id and phase = 'knockout'
    and round_number = v_last_round
  order by match_number
  limit 1;

  if v_final.winner_team_id is not null then
    update public.tournaments
    set status = 'completed', winner_team_id = v_final.winner_team_id
    where id = p_tournament_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. RPCs administrativos
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_registration_open(p_open boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_admin_role() then
    raise exception 'Acesso restrito à organização.';
  end if;

  update public.app_settings
  set registration_open = p_open, updated_at = now()
  where id = 1;
end;
$$;

create or replace function public.admin_generate_tournament(
  p_modality_id uuid,
  p_format text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_modality public.modalities%rowtype;
  v_tournament_id uuid;
  v_team_count integer;
  v_group_count integer;
  v_group text;
  v_team_ids uuid[];
  v_i integer;
  v_j integer;
  v_match_number integer := 0;
begin
  if not public.has_admin_role() then
    raise exception 'Acesso restrito à organização.';
  end if;

  if p_format is null or p_format not in ('knockout', 'groups') then
    raise exception 'Formato de campeonato inválido.';
  end if;

  if coalesce((select registration_open from public.app_settings where id = 1), true) then
    raise exception 'Finalize as inscrições antes de gerar o sorteio.';
  end if;

  select * into v_modality from public.modalities where id = p_modality_id;
  if not found then raise exception 'Modalidade não encontrada.'; end if;

  select count(*) into v_team_count
  from public.teams t
  where t.modality_id = p_modality_id
    and not t.is_banned
    and (select count(*) from public.team_members tm where tm.team_id = t.id and not tm.is_banned) = v_modality.participants_per_team
    and not exists (select 1 from public.team_members tm where tm.team_id = t.id and tm.is_banned);

  if v_team_count < 2 then
    raise exception 'A modalidade precisa ter pelo menos duas inscrições aptas.';
  end if;
  if p_format = 'groups' and v_team_count < 6 then
    raise exception 'O formato grupos + mata-mata exige ao menos seis equipes nesta modalidade.';
  end if;

  if exists (
    select 1 from public.tournaments
    where modality_id = p_modality_id and status <> 'completed'
  ) then
    raise exception 'Já existe um campeonato em andamento nesta modalidade.';
  end if;

  insert into public.tournaments (modality_id, format, status, participants_per_team)
  values (p_modality_id, p_format, case when p_format = 'groups' then 'groups' else 'knockout' end, v_modality.participants_per_team)
  returning id into v_tournament_id;

  if p_format = 'groups' then
    -- Mantém os grupos equilibrados e o número de classificados em potência de dois.
    v_group_count := 2;
    while v_team_count > (v_group_count * 4) and v_group_count < 16 loop
      v_group_count := v_group_count * 2;
    end loop;

    insert into public.tournament_entries (tournament_id, team_id, group_name, seed)
    select v_tournament_id,
           ranked.id,
           chr(65 + mod(ranked.rn - 1, v_group_count)),
           ranked.rn
    from (
      select t.id, row_number() over (order by random())::integer as rn
      from public.teams t
      where t.modality_id = p_modality_id
        and not t.is_banned
        and (select count(*) from public.team_members tm where tm.team_id = t.id and not tm.is_banned) = v_modality.participants_per_team
        and not exists (select 1 from public.team_members tm where tm.team_id = t.id and tm.is_banned)
    ) ranked;

    for v_group in
      select distinct group_name from public.tournament_entries
      where tournament_id = v_tournament_id order by group_name
    loop
      select array_agg(team_id order by seed) into v_team_ids
      from public.tournament_entries
      where tournament_id = v_tournament_id and group_name = v_group;

      for v_i in 1..(array_length(v_team_ids, 1) - 1) loop
        for v_j in (v_i + 1)..array_length(v_team_ids, 1) loop
          v_match_number := v_match_number + 1;
          insert into public.tournament_matches (
            tournament_id, phase, group_name, round_number, match_number,
            home_team_id, away_team_id, status
          ) values (
            v_tournament_id, 'groups', v_group, 1, v_match_number,
            v_team_ids[v_i], v_team_ids[v_j], 'pending'
          );
        end loop;
      end loop;
    end loop;
  else
    select array_agg(id order by random()) into v_team_ids
    from public.teams t
    where t.modality_id = p_modality_id
      and not t.is_banned
      and (select count(*) from public.team_members tm where tm.team_id = t.id and not tm.is_banned) = v_modality.participants_per_team
      and not exists (select 1 from public.team_members tm where tm.team_id = t.id and tm.is_banned);

    perform public._create_knockout_bracket(v_tournament_id, v_team_ids);
    perform public._finish_tournament_if_done(v_tournament_id);
  end if;

  return v_tournament_id;
end;
$$;

create or replace function public.admin_start_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_match public.tournament_matches%rowtype;
begin
  if not public.has_admin_role() then raise exception 'Acesso restrito à organização.'; end if;

  select * into v_match from public.tournament_matches where id = p_match_id for update;
  if not found then raise exception 'Partida não encontrada.'; end if;
  if v_match.status <> 'pending' then raise exception 'Esta partida não está aguardando início.'; end if;
  if v_match.home_team_id is null or v_match.away_team_id is null then
    raise exception 'Esta partida ainda não tem os dois competidores definidos.';
  end if;

  update public.tournament_matches
  set status = 'in_progress',
      home_score = coalesce(home_score, 0),
      away_score = coalesce(away_score, 0),
      started_at = now()
  where id = p_match_id;
end;
$$;

create or replace function public.admin_increment_match_score(
  p_match_id uuid,
  p_side text,
  p_delta integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_match public.tournament_matches%rowtype;
  v_current integer;
begin
  if not public.has_admin_role() then raise exception 'Acesso restrito à organização.'; end if;
  if p_side is null or p_side not in ('home', 'away') or p_delta is null or p_delta not in (-1, 1) then
    raise exception 'Atualização de placar inválida.';
  end if;

  select * into v_match from public.tournament_matches where id = p_match_id for update;
  if not found then raise exception 'Partida não encontrada.'; end if;
  if v_match.status <> 'in_progress' then raise exception 'Inicie a partida antes de alterar o placar.'; end if;

  if p_side = 'home' then
    v_current := coalesce(v_match.home_score, 0);
    if v_current + p_delta < 0 then raise exception 'O placar não pode ficar negativo.'; end if;
    if v_current + p_delta > 250 then raise exception 'O placar ultrapassou o limite permitido.'; end if;
    update public.tournament_matches set home_score = v_current + p_delta where id = p_match_id;
  else
    v_current := coalesce(v_match.away_score, 0);
    if v_current + p_delta < 0 then raise exception 'O placar não pode ficar negativo.'; end if;
    if v_current + p_delta > 250 then raise exception 'O placar ultrapassou o limite permitido.'; end if;
    update public.tournament_matches set away_score = v_current + p_delta where id = p_match_id;
  end if;
end;
$$;

create or replace function public.admin_finish_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_match public.tournament_matches%rowtype;
  v_home_score integer;
  v_away_score integer;
  v_winner uuid;
begin
  if not public.has_admin_role() then raise exception 'Acesso restrito à organização.'; end if;

  select * into v_match from public.tournament_matches where id = p_match_id for update;
  if not found then raise exception 'Partida não encontrada.'; end if;
  if v_match.status <> 'in_progress' then raise exception 'Esta partida não está em andamento.'; end if;

  v_home_score := coalesce(v_match.home_score, 0);
  v_away_score := coalesce(v_match.away_score, 0);

  if v_match.phase = 'knockout' and v_home_score = v_away_score then
    raise exception 'No mata-mata, é necessário definir um vencedor antes de encerrar a partida.';
  end if;

  if v_home_score > v_away_score then v_winner := v_match.home_team_id;
  elsif v_away_score > v_home_score then v_winner := v_match.away_team_id;
  else v_winner := null;
  end if;

  update public.tournament_matches
  set status = 'completed',
      home_score = v_home_score,
      away_score = v_away_score,
      winner_team_id = v_winner,
      finished_at = now()
  where id = p_match_id;

  if v_match.phase = 'knockout' then
    perform public._propagate_knockout_result(
      v_match.tournament_id, v_match.round_number, v_match.match_number, v_winner
    );
    perform public._finish_tournament_if_done(v_match.tournament_id);
  end if;
end;
$$;

create or replace function public.admin_generate_playoffs(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_groups text[];
  v_group_index integer;
  v_group_one text;
  v_group_two text;
  v_team_one uuid;
  v_team_two uuid;
  v_qualified uuid[] := array[]::uuid[];
  v_count integer;
begin
  if not public.has_admin_role() then raise exception 'Acesso restrito à organização.'; end if;

  select * into v_tournament from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception 'Campeonato não encontrado.'; end if;
  if v_tournament.format <> 'groups' or v_tournament.status <> 'groups' then
    raise exception 'Este campeonato não está aguardando a geração do mata-mata.';
  end if;

  if exists (
    select 1 from public.tournament_matches
    where tournament_id = p_tournament_id and phase = 'groups'
      and status not in ('completed', 'bye')
  ) then
    raise exception 'Finalize todos os jogos da fase de grupos antes de gerar o mata-mata.';
  end if;

  select array_agg(group_name order by group_name) into v_groups
  from (select distinct group_name from public.tournament_entries where tournament_id = p_tournament_id) g;

  if coalesce(array_length(v_groups, 1), 0) < 2 or mod(array_length(v_groups, 1), 2) <> 0 then
    raise exception 'A quantidade de grupos não permite montar a fase final.';
  end if;

  -- Os dois primeiros de cada grupo avançam; os cruzamentos são entre grupos diferentes.
  for v_group_index in 1..array_length(v_groups, 1) by 2 loop
    v_group_one := v_groups[v_group_index];
    v_group_two := v_groups[v_group_index + 1];

    with played as (
      select m.home_team_id as team_id, m.group_name,
        case when m.home_score > m.away_score then 3 when m.home_score = m.away_score then 1 else 0 end as points,
        coalesce(m.home_score, 0) as goals_for, coalesce(m.away_score, 0) as goals_against
      from public.tournament_matches m
      where m.tournament_id = p_tournament_id and m.phase = 'groups'
      union all
      select m.away_team_id as team_id, m.group_name,
        case when m.away_score > m.home_score then 3 when m.away_score = m.home_score then 1 else 0 end as points,
        coalesce(m.away_score, 0) as goals_for, coalesce(m.home_score, 0) as goals_against
      from public.tournament_matches m
      where m.tournament_id = p_tournament_id and m.phase = 'groups'
    ), stats as (
      select e.team_id, e.group_name, t.name,
        coalesce(sum(p.points), 0) as points,
        coalesce(sum(p.goals_for - p.goals_against), 0) as goal_difference,
        coalesce(sum(p.goals_for), 0) as goals_for
      from public.tournament_entries e
      join public.teams t on t.id = e.team_id
      left join played p on p.team_id = e.team_id and p.group_name = e.group_name
      where e.tournament_id = p_tournament_id
      group by e.team_id, e.group_name, t.name
    ), ranked as (
      select *, row_number() over (
        partition by group_name
        order by points desc, goal_difference desc, goals_for desc, name asc
      ) as position
      from stats
    )
    select team_id into v_team_one from ranked
    where group_name = v_group_one and position = 1;

    with played as (
      select m.home_team_id as team_id, m.group_name,
        case when m.home_score > m.away_score then 3 when m.home_score = m.away_score then 1 else 0 end as points,
        coalesce(m.home_score, 0) as goals_for, coalesce(m.away_score, 0) as goals_against
      from public.tournament_matches m
      where m.tournament_id = p_tournament_id and m.phase = 'groups'
      union all
      select m.away_team_id as team_id, m.group_name,
        case when m.away_score > m.home_score then 3 when m.away_score = m.home_score then 1 else 0 end as points,
        coalesce(m.away_score, 0) as goals_for, coalesce(m.home_score, 0) as goals_against
      from public.tournament_matches m
      where m.tournament_id = p_tournament_id and m.phase = 'groups'
    ), stats as (
      select e.team_id, e.group_name, t.name,
        coalesce(sum(p.points), 0) as points,
        coalesce(sum(p.goals_for - p.goals_against), 0) as goal_difference,
        coalesce(sum(p.goals_for), 0) as goals_for
      from public.tournament_entries e
      join public.teams t on t.id = e.team_id
      left join played p on p.team_id = e.team_id and p.group_name = e.group_name
      where e.tournament_id = p_tournament_id
      group by e.team_id, e.group_name, t.name
    ), ranked as (
      select *, row_number() over (
        partition by group_name
        order by points desc, goal_difference desc, goals_for desc, name asc
      ) as position
      from stats
    )
    select team_id into v_team_two from ranked
    where group_name = v_group_two and position = 2;

    v_qualified := array_append(v_qualified, v_team_one);

    with played as (
      select m.home_team_id as team_id, m.group_name,
        case when m.home_score > m.away_score then 3 when m.home_score = m.away_score then 1 else 0 end as points,
        coalesce(m.home_score, 0) as goals_for, coalesce(m.away_score, 0) as goals_against
      from public.tournament_matches m
      where m.tournament_id = p_tournament_id and m.phase = 'groups'
      union all
      select m.away_team_id as team_id, m.group_name,
        case when m.away_score > m.home_score then 3 when m.away_score = m.home_score then 1 else 0 end as points,
        coalesce(m.away_score, 0) as goals_for, coalesce(m.home_score, 0) as goals_against
      from public.tournament_matches m
      where m.tournament_id = p_tournament_id and m.phase = 'groups'
    ), stats as (
      select e.team_id, e.group_name, t.name,
        coalesce(sum(p.points), 0) as points,
        coalesce(sum(p.goals_for - p.goals_against), 0) as goal_difference,
        coalesce(sum(p.goals_for), 0) as goals_for
      from public.tournament_entries e
      join public.teams t on t.id = e.team_id
      left join played p on p.team_id = e.team_id and p.group_name = e.group_name
      where e.tournament_id = p_tournament_id
      group by e.team_id, e.group_name, t.name
    ), ranked as (
      select *, row_number() over (
        partition by group_name
        order by points desc, goal_difference desc, goals_for desc, name asc
      ) as position
      from stats
    )
    select team_id into v_team_one from ranked
    where group_name = v_group_two and position = 1;

    v_qualified := array_append(v_qualified, v_team_one);

    with played as (
      select m.home_team_id as team_id, m.group_name,
        case when m.home_score > m.away_score then 3 when m.home_score = m.away_score then 1 else 0 end as points,
        coalesce(m.home_score, 0) as goals_for, coalesce(m.away_score, 0) as goals_against
      from public.tournament_matches m
      where m.tournament_id = p_tournament_id and m.phase = 'groups'
      union all
      select m.away_team_id as team_id, m.group_name,
        case when m.away_score > m.home_score then 3 when m.away_score = m.home_score then 1 else 0 end as points,
        coalesce(m.away_score, 0) as goals_for, coalesce(m.home_score, 0) as goals_against
      from public.tournament_matches m
      where m.tournament_id = p_tournament_id and m.phase = 'groups'
    ), stats as (
      select e.team_id, e.group_name, t.name,
        coalesce(sum(p.points), 0) as points,
        coalesce(sum(p.goals_for - p.goals_against), 0) as goal_difference,
        coalesce(sum(p.goals_for), 0) as goals_for
      from public.tournament_entries e
      join public.teams t on t.id = e.team_id
      left join played p on p.team_id = e.team_id and p.group_name = e.group_name
      where e.tournament_id = p_tournament_id
      group by e.team_id, e.group_name, t.name
    ), ranked as (
      select *, row_number() over (
        partition by group_name
        order by points desc, goal_difference desc, goals_for desc, name asc
      ) as position
      from stats
    )
    select team_id into v_team_two from ranked
    where group_name = v_group_one and position = 2;

    v_qualified := array_append(v_qualified, v_team_two);
  end loop;

  v_count := coalesce(array_length(v_qualified, 1), 0);
  if v_count <> array_length(v_groups, 1) * 2 or exists (select 1 from unnest(v_qualified) q where q is null) then
    raise exception 'Não foi possível definir os dois classificados de cada grupo.';
  end if;

  perform public._create_knockout_bracket(p_tournament_id, v_qualified);
  update public.tournaments set status = 'playoffs' where id = p_tournament_id;
  perform public._finish_tournament_if_done(p_tournament_id);
end;
$$;

create or replace function public.admin_reset_interclasse_data()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_admin_role() then raise exception 'Acesso restrito à organização.'; end if;

  delete from public.tournaments;
  delete from public.teams;
  delete from public.modalities;
  update public.app_settings set registration_open = true, updated_at = now() where id = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Leitura pública e administrativa dos campeonatos (JSON esperado pelo site)
-- ---------------------------------------------------------------------------

create or replace function public.get_public_tournaments()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'registration_open', coalesce((select s.registration_open from public.app_settings s where s.id = 1), true),
    'tournaments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'modality_id', t.modality_id,
          'modality_name', md.name,
          'participants_per_team', t.participants_per_team,
          'format', t.format,
          'status', t.status,
          'winner_team_name', wt.name,
          'winner_classroom', wt.classroom,
          'created_at', t.created_at,
          'entries', coalesce((
            select jsonb_agg(
              jsonb_build_object('team_id', e.team_id, 'group_name', e.group_name, 'seed', e.seed)
              order by e.seed
            )
            from public.tournament_entries e where e.tournament_id = t.id
          ), '[]'::jsonb),
          'matches', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', m.id,
                'phase', m.phase,
                'group_name', m.group_name,
                'round_number', m.round_number,
                'match_number', m.match_number,
                'home_team_id', m.home_team_id,
                'away_team_id', m.away_team_id,
                'home_team_name', ht.name,
                'away_team_name', at.name,
                'home_classroom', ht.classroom,
                'away_classroom', at.classroom,
                'home_score', m.home_score,
                'away_score', m.away_score,
                'status', m.status,
                'winner_team_id', m.winner_team_id,
                'started_at', m.started_at,
                'finished_at', m.finished_at
              )
              order by m.phase, m.round_number, m.match_number
            )
            from public.tournament_matches m
            left join public.teams ht on ht.id = m.home_team_id
            left join public.teams at on at.id = m.away_team_id
            where m.tournament_id = t.id
          ), '[]'::jsonb)
        ) order by t.created_at desc
      )
      from public.tournaments t
      join public.modalities md on md.id = t.modality_id
      left join public.teams wt on wt.id = t.winner_team_id
    ), '[]'::jsonb)
  );
$$;

create or replace function public.get_admin_tournaments()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_admin_role() then raise exception 'Acesso restrito à organização.'; end if;
  return public.get_public_tournaments();
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Permissões de execução das RPCs
-- ---------------------------------------------------------------------------

revoke all on function public.register_team(uuid, text, text, jsonb) from public;
revoke all on function public.admin_set_registration_open(boolean) from public;
revoke all on function public.admin_generate_tournament(uuid, text) from public;
revoke all on function public.admin_start_match(uuid) from public;
revoke all on function public.admin_increment_match_score(uuid, text, integer) from public;
revoke all on function public.admin_finish_match(uuid) from public;
revoke all on function public.admin_generate_playoffs(uuid) from public;
revoke all on function public.admin_reset_interclasse_data() from public;
revoke all on function public.get_public_tournaments() from public;
revoke all on function public.get_admin_tournaments() from public;
revoke all on function public._propagate_knockout_result(uuid, integer, integer, uuid) from public;
revoke all on function public._create_knockout_bracket(uuid, uuid[]) from public;
revoke all on function public._finish_tournament_if_done(uuid) from public;

grant execute on function public.register_team(uuid, text, text, jsonb) to anon, authenticated;
grant execute on function public.get_public_tournaments() to anon, authenticated;
grant execute on function public.get_admin_tournaments() to authenticated;
grant execute on function public.admin_set_registration_open(boolean) to authenticated;
grant execute on function public.admin_generate_tournament(uuid, text) to authenticated;
grant execute on function public.admin_start_match(uuid) to authenticated;
grant execute on function public.admin_increment_match_score(uuid, text, integer) to authenticated;
grant execute on function public.admin_finish_match(uuid) to authenticated;
grant execute on function public.admin_generate_playoffs(uuid) to authenticated;
grant execute on function public.admin_reset_interclasse_data() to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- PRÓXIMO PASSO: crie um usuário em Authentication > Users no Supabase.
-- Copie o UUID desse usuário e execute este comando substituindo o texto:
-- insert into public.admin_users (user_id)
-- values ('COLE-AQUI-O-UUID-DO-USUARIO');
-- ---------------------------------------------------------------------------
