import { createClient } from "@supabase/supabase-js";

// Remplace ces deux valeurs par celles de ton projet Supabase
// (Project Settings > API > Project URL / anon public key)
const SUPABASE_URL = "https://wklddwumirkdjkbxvzyj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_nacX-UD9ZwjpJ1C9Za8xxQ_tIhHW8nO";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
