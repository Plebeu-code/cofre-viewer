-- Cofre Hub: sincronização opcional entre pessoas e máquinas.
-- Rode este arquivo uma vez no SQL Editor do seu projeto Supabase.
-- Cada projeto pertence a quem o enviou; o dono pode compartilhar por e-mail.

create table if not exists public.cofre_projects (
  id          text        not null,
  owner       uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  name        text        not null,
  payload     jsonb       not null,            -- { files, kanban, meta }
  version     integer     not null default 1,  -- controle de concorrência otimista
  shared_with text[]      not null default '{}',
  updated_by  text,
  updated_at  timestamptz not null default now(),
  primary key (owner, id)
);

alter table public.cofre_projects enable row level security;

drop policy if exists "ler: dono ou compartilhado" on public.cofre_projects;
create policy "ler: dono ou compartilhado" on public.cofre_projects
  for select using (owner = auth.uid() or (auth.jwt() ->> 'email') = any (shared_with));

drop policy if exists "criar: só o dono" on public.cofre_projects;
create policy "criar: só o dono" on public.cofre_projects
  for insert with check (owner = auth.uid());

drop policy if exists "editar: dono ou compartilhado" on public.cofre_projects;
create policy "editar: dono ou compartilhado" on public.cofre_projects
  for update using (owner = auth.uid() or (auth.jwt() ->> 'email') = any (shared_with))
  with check (owner = auth.uid() or (auth.jwt() ->> 'email') = any (shared_with));

drop policy if exists "excluir: só o dono" on public.cofre_projects;
create policy "excluir: só o dono" on public.cofre_projects
  for delete using (owner = auth.uid());

-- Quem recebeu o compartilhamento edita o conteúdo, mas não troca o dono
-- nem a lista de compartilhamento.
create or replace function public.cofre_guard() returns trigger
language plpgsql security invoker as $$
begin
  if new.owner <> old.owner then
    raise exception 'O dono do projeto não pode ser alterado.';
  end if;
  if old.owner <> auth.uid() and new.shared_with is distinct from old.shared_with then
    raise exception 'Só o dono pode alterar o compartilhamento.';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists cofre_guard on public.cofre_projects;
create trigger cofre_guard before update on public.cofre_projects
  for each row execute function public.cofre_guard();
