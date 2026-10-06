// The app site's Supabase project: its URL and publishable key (safe in the browser; every
// write is checked by the database against who is signed in). Empty until the project exists,
// and the app says sign-in is coming. email: true once an email sender is set up in Supabase.
export const APP_CONFIG = { url: '', key: '', email: false };
