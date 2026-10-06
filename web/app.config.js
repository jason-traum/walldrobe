// The app site's Supabase project (Walldrobe, us-east-1): its URL and publishable key (safe in
// the browser; every write is checked by the database against who is signed in).
// email: true once an email sender is set up in Supabase (it only mails its own team until then).
// plan: the full plan (where the art comes from, the buy list, printing and frames). open is
// false while Unlock is a fake door that only records who asked; price is shown on the
// Unlock page when set ('' shows none).
export const APP_CONFIG = {
  url: 'https://oeqdhzzwhpsphmdubdxj.supabase.co',
  key: 'sb_publishable_lNE-aSBNTa-4gdecRU04kg_3VaRM41Z',
  email: false,
  plan: { open: false, price: '' },
};
