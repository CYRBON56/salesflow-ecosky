-- À exécuter dans Supabase : SQL Editor > New query > Run

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  telephone text not null,
  email text default '',
  source text default '',
  stage text default 'nouveau',
  notes text default '',
  created_at timestamptz default now()
);

create table if not exists settings (
  id int primary key default 1,
  catalogue_url text default 'https://www.ecoskybyrms.fr/nos-services-et-prestations/catalogue',
  devis_url text default 'https://www.ecoskybyrms.fr/devis',
  templates jsonb default '{
    "intro": "Bonjour {nom}, ici RMS ECOSKY. Merci pour votre demande, on revient vers vous rapidement pour votre projet. À très vite !",
    "catalogue": "Bonjour {nom}, voici notre catalogue EcoSky by RMS : {catalogue_url}\nN''hésitez pas à me dire ce qui vous intéresse, je reste dispo.",
    "devis": "Bonjour {nom}, pour vous préparer un chiffrage précis, pourriez-vous nous envoyer quelques photos (ou une courte vidéo) de la zone concernée via ce lien : {devis_url}\nMerci, on revient vers vous rapidement !"
  }'::jsonb
);

insert into settings (id) values (1) on conflict (id) do nothing;

-- Sécurité : active la RLS mais autorise l'accès via la clé "anon"
-- (suffisant pour un usage interne équipe ; on pourra durcir plus tard si besoin)
alter table leads enable row level security;
alter table settings enable row level security;

create policy "allow all on leads" on leads for all using (true) with check (true);
create policy "allow all on settings" on settings for all using (true) with check (true);

-- Active le temps réel pour que les nouveaux leads apparaissent instantanément dans l'app
alter publication supabase_realtime add table leads;
