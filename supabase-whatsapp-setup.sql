-- À exécuter dans Supabase : SQL Editor > New query > Run

create table if not exists wa_messages (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  role text not null, -- 'user' ou 'assistant'
  content text not null,
  created_at timestamptz default now()
);

create table if not exists wa_conversations (
  phone text primary key,
  nom text default '',
  stage text default 'nouveau', -- nouveau, qualification, devis_envoye, termine
  last_message_at timestamptz default now(),
  lead_id uuid references leads(id)
);

alter table wa_messages enable row level security;
alter table wa_conversations enable row level security;

create policy "allow all on wa_messages" on wa_messages for all using (true) with check (true);
create policy "allow all on wa_conversations" on wa_conversations for all using (true) with check (true);

alter publication supabase_realtime add table wa_messages;
alter publication supabase_realtime add table wa_conversations;
