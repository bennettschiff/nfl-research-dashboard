import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// NFL data lives in the `nfl` schema of the shared host project (MLB uses
// public). All client reads go through this schema by default.
export const supabase = createClient(url, key, {
  auth: { persistSession: false },
  db: { schema: 'nfl' },
})
